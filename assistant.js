/* ═══════════════════════════════════════
   GoldPro — Voice Assistant (ar-DZ)
   مجاني 100% | Web Speech API
   ════════════════════════════════════ */
window.VA = (() => {

    /* ── State ── */
    let recog       = null;
    let isListening = false;
    let ttsOn       = false;
    let nameMap     = {};        // learned: spoken → actual
    let _pickCb     = null;      // pending confirm callback

    /* ════════════ SESSION CONTEXT — سياق الحوار ════════════
       يحفظ معلومات الجلسة الحالية لتفسير الأوامر الناقصة      */
    const SessionContext = {
        lastActiveCustomer : null,   /* آخر زبون تم التعامل معه                  */
        lastGoldType       : null,   /* آخر عيار ذُكر (ذهب 730 | ذهب 24)         */
        lastAmount         : null,   /* آخر كمية/مبلغ ذُكر                       */
        lastCurrency       : null,   /* آخر عملة (دينار | دولار | ذهب)           */
        setCustomer(n)     { if (n) this.lastActiveCustomer = n; },
    };

    /* أمر ناقص ينتظر تأكيد الزبون { verb, amount, unit } */
    let _pendingCmd = null;

    /* ════════════ INIT ════════════ */
    function init() {
        _loadNames();
        _learnLoad();
        _bindHotkey();
        _initDrag();
        /* التنبيهات الاستباقية بعد تحميل البيانات */
        setTimeout(checkProactiveAlerts, 3500);
    }

    /* ════════════ DRAGGABLE FAB ════════════ */
    function _initDrag() {
        const wrap = document.getElementById('vaMicWrap');
        if (!wrap) return;

        let sx, sy, sl, st, active = false, moved = false, justDragged = false;

        function _cx(x) { return Math.max(4, Math.min(window.innerWidth  - (wrap.offsetWidth  || 60) - 4, x)); }
        function _cy(y) { return Math.max(4, Math.min(window.innerHeight - (wrap.offsetHeight || 98) - 4, y)); }

        function _applyPos(x, y) {
            wrap.style.left   = _cx(x) + 'px';
            wrap.style.top    = _cy(y) + 'px';
            wrap.style.right  = 'auto';
            wrap.style.bottom = 'auto';
        }

        /* اضبط الموضع الأولي من bottom → top حتى يبقى السحب متسقاً */
        function _anchorToTop() {
            const r = wrap.getBoundingClientRect();
            _applyPos(r.left, r.top);
        }

        /* استعادة موضع محفوظ */
        try {
            const p = JSON.parse(localStorage.getItem('va_pos') || 'null');
            if (p && typeof p.l === 'number') {
                _anchorToTop();                          /* إزالة bottom أولاً */
                _applyPos(p.l, p.t);
            }
        } catch(e) {}

        /* امنع تشغيل الميكروفون إذا كان المستخدم يسحب (desktop) */
        wrap.addEventListener('click', function(e) {
            if (justDragged) { e.stopPropagation(); e.preventDefault(); justDragged = false; }
        }, true);

        function onStart(e) {
            if (e.button && e.button !== 0) return;
            const pt = e.touches ? e.touches[0] : e;
            /* تحويل إلى top/left إذا لم يتم بعد */
            if (wrap.style.bottom && wrap.style.bottom !== 'auto') _anchorToTop();
            const r = wrap.getBoundingClientRect();
            sl = r.left; st = r.top;
            sx = pt.clientX; sy = pt.clientY;
            moved = false; active = true;
            wrap.classList.add('va-fab-dragging');
        }

        function onMove(e) {
            if (!active) return;
            const pt = e.touches ? e.touches[0] : e;
            const dx = pt.clientX - sx, dy = pt.clientY - sy;
            if (!moved && Math.hypot(dx, dy) > 8) moved = true;
            if (moved) {
                _applyPos(sl + dx, st + dy);
                e.preventDefault();
            }
        }

        function onEnd() {
            if (!active) return;
            active = false;
            wrap.classList.remove('va-fab-dragging');
            if (moved) {
                justDragged = true;
                setTimeout(function() { justDragged = false; }, 350);
                const r = wrap.getBoundingClientRect();
                try { localStorage.setItem('va_pos', JSON.stringify({l: Math.round(r.left), t: Math.round(r.top)})); } catch(e) {}
            }
            moved = false;
        }

        /* أحداث اللمس */
        wrap.addEventListener('touchstart',    onStart, {passive: true});
        wrap.addEventListener('touchmove',     onMove,  {passive: false});
        wrap.addEventListener('touchend',      onEnd);
        wrap.addEventListener('touchcancel',   onEnd);

        /* أحداث الماوس */
        wrap.addEventListener('mousedown',     onStart, {passive: true});
        document.addEventListener('mousemove', onMove,  {passive: false});
        document.addEventListener('mouseup',   onEnd);

        /* إبقاؤه داخل الشاشة عند تغيير الحجم */
        window.addEventListener('resize', function() {
            if (wrap.style.bottom === 'auto' || wrap.style.bottom === '') {
                const r = wrap.getBoundingClientRect();
                _applyPos(r.left, r.top);
            }
        }, {passive: true});
    }

    /* ════════════ NAME LEARNING ════════════ */
    function _loadNames() {
        try { nameMap = JSON.parse(localStorage.getItem('va_nm') || '{}'); } catch(e) { nameMap = {}; }
    }
    function _saveNames() {
        try { localStorage.setItem('va_nm', JSON.stringify(nameMap)); } catch(e) {}
    }
    function learnName(spoken, actual) {
        if (!spoken || !actual || spoken === actual) return;
        nameMap[spoken] = actual;
        _saveNames();
    }

    /* ════════════════════════════════════════════════════════════════
       INTENT ENGINE — فهم النية لا مطابقة الكلمة
       ════════════════════════════════════════════════════════════════
       المبدأ: بدل ترجمة كل كلمة، نستخلص ثلاثة عناصر:
         VERB   — ماذا يريد (navigate / balance / invoice / settle …)
         ENTITY — على مَن/ماذا (اسم زبون | عملة | كمية | وجهة)
         VALUE  — أرقام مصاحبة

       ثم router يوصّل Intent → Function مباشرة.
       _norm() تبقى لتنظيف الشكل فقط (همزة، تشكيل، ترقيم).
    ════════════════════════════════════════════════════════════════ */

    /* ── تنظيف الشكل فقط — لا تغيير معنى ── */
    function _norm(raw) {
        let t = (raw || '').trim();
        /* إزالة التشكيل */
        t = t.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, '');
        /* توحيد الحروف */
        t = t.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
        /* تحويل الأرقام العربية/الفارسية → لاتينية: ٣٤٥ → 345 */
        t = t.replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660);
        t = t.replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06F0);
        /* فصل الرقم عن الحرف الملتصق (100غ → 100 غ) ثم محرّك الأرقام الموحّد المشترك
           (المعرّف في app.js): يدعم المركّبات بـ«و»، ملاير/ملايين، زوج/جوج=٢، فاصل الآلاف… */
        t = t.replace(/(\d)([\u0621-\u064A])/g, '$1 $2').replace(/([\u0621-\u064A])(\d)/g, '$1 $2');
        if (typeof _arNumberize === 'function') t = _arNumberize(t);
        /* إزالة الترقيم */
        t = t.replace(/[.،,؟?!:;]/g, '');
        return t.replace(/\s+/g, ' ').trim();
    }

    /* ══════════════════════════════════════════
       INTENT CLASSIFIER — يُصنّف الجملة → intent
    ══════════════════════════════════════════ */

    /* خريطة الأفعال: كل فعل → مجموعة مرادفاته */
    const _VERBS = {
        navigate : /^(?:روح|اذهب|انتقل|افتح|فتح|اعرض|شوف|دير|عرض|ابعث|ودي|خذني|وريني|ودعني|اظهر|انقل لـ|انقل ل)\b/,
        mybal    : /(?:حسابي|رصيدي|واش عندي|شحال عندي|كم عندي|ما لدي|ما عندي|وضعيتي|حالتي|عندي قداش|ما عندي شي|ما لدي شي|رصيد نفسي|ماليتي)/,
        custbal  : /(?:حساب|رصيد|واش عند|شحال عند|كم عند|ما عند|ديون|مديونيه|معاملات|ما يسال|شو يسال)\s+\S/,
        invoice  : /(?:فاتوره?|فاتير|فتوره?|اتورة|انشئ|اصدر|انجز|حضر|خذ|كتب|سجل|بادر|دير|اعمل)\s+(?:بيع|شراء|بيعه|شرا|بيت|اشتريت|بيعي|شرائي)/,
        settle   : /(?:صفي|صفّي|خلص|تصفيه?|سوي حساب|قلص|حل الحساب|اقفل الحساب|اسدد|صلح|ختم|اغلق الحساب|خلصه|سدد|قدّم الحساب|اعمل تصفيه?)\s+\S/,
        inventory: /(?:المخزون|مخزوني|مخزون|مستودع|عندك ذهب|ما عندك|عرض الذهب|السبائك|الاحتياطي|ما لديك|وضعية المخزون|كم سبيكه?)/,
        rafsave  : /^(?:حول|احول|تحويل)\s+(?:ل|لل|الى\s+(?:ال)?|إلى\s+(?:ال)?)(?:رافيناج|رافناج|صهر|تكرير)(?:[^\u0600-\u06FF]|$)/,
        rafmove  : /(?:انقل|حول|دير|نقل|ضع|وضع|ارسل)\s+.{0,20}(?:سبا[يئ]ك|ذهب|مخزون).{0,20}(?:رافيناج|رافناج|صهر|تكرير)|(?:رافيناج|رافناج|صهر|تكرير).{0,20}(?:انقل|حول|كل|جميع|السبائك|الذهب)|(?:انقل|حول)\s+(?:كل|جميع)\s+(?:السبائك|الذهب)/,
        rafrow   : null,  /* يُحدَّد من السياق (صفحة رافيناج + أرقام) */
        invrow   : null,  /* يُحدَّد من السياق (صفحة فاتورة + أرقام) */
        transfer : /(?:اعطيت|سلمت|دفعت|ادفعت|وزعت|ارسلت|حولت|بعثت|وصلت|سلّمت|اوصلت|خليت|ودعت|دافع|مسلّم|موزّع|اخذت|خذيت)\s+\S|(?:\S+\s+(?:دفع|سلّم|سلم|اعطى|اعطا|ارسل|جاب|ودع|بعث|اوصل|وصّل|حوّل|خلّص|اخذ|اخد|خدا|خدى|ياخذ))/,
        shipping : /^(?:شحن|شحنه|ارسلنا|ارسل|ارسلت|بعثت)\b|شحن\s+\d/,
        dolbuy   : /(?:بيع|شراء|اشتريت|بعت|جبت)\s+دولار/,
        expenses : /^مصاريف\b/,
        dubai    : /(?:احسبلي|احسب|مدلي|عطيني|كالكيل|حسابلي|سعر البيع).{0,10}دبي|دبي.{0,10}(?:احسب|سعر|الشحن|مصاريف|دولار)/,
        myweek   : /(?:شحال|كم|واش|ايش).{0,12}(?:دخل|ربح|بيعنا|بعنا|جبنا|كسبنا|ايراد).{0,12}(?:اسبوع|أسبوع|الاسبوع|هذا الاسبوع)|(?:ايراد|دخل|ربح).{0,8}(?:اسبوع|أسبوع)|بيع.{0,8}(?:الاسبوع|هذا الاسبوع)/,
        mymonth  : /(?:شحال|كم|واش|ايش).{0,12}(?:دخل|ربح|بيعنا|بعنا|جبنا|كسبنا|ايراد).{0,12}(?:شهر|الشهر|هذا الشهر)|(?:ايراد|دخل|ربح).{0,8}(?:شهر|الشهر)/,
        buysum   : /(?:شحال|قداش|كم|وش|واش|اش)\s*(?:شريت|اشتريت|شرينا|اشترينا|اشتري)/,
        activity : /(?:وش|واش|اش|شنو|شن|شو)\s*(?:درت|دريت|عملت|عملنا|خدمت|خدمنا|سويت|سوينا|دارنا)/,
        alldebts : /(?:كم|شحال|واش|اجمالي|ملخص).{0,10}(?:الديون|ديون|المديونيه?)|^(?:الديون|ملخص الديون|اجمالي الديون|ديوني|مستحقاتي)$/,
        help     : /^(?:مساعده?|help|الاوامر|ايش تقدر|كيف نستعملك|ما تقدر تسوي|كيف تشتغل|ساعدني|شو تقدر|وش تعرف)$/,
        learn    : /^(?:علمني|تعلم|احفظ|سجل)\s+/,
        tts      : /^(?:شغل الصوت|وقف الصوت|فعّل الصوت|اقف الصوت|صوت|تكلم|اسمع|بدون صوت)/,
        unknown  : null,
    };

    /* وجهات التنقل — مرادفات لكل صفحة */
    const _PAGES = [
        { id: 'home',      rx: /رئيسي|هوم|البيت|الداشبورد|الرئيسيه?|شاشه رئيسيه?|صفحه رئيسيه?/ },
        { id: 'invoice',   rx: /فاتوره?|فواتير|فتوره?|اتورة|بيعيه|مبيعات/ },
        { id: 'raffinage', rx: /رافيناج|رافناج|صهر|تكرير|رفينج/ },
        { id: 'log',       rx: /سجل|عمليات|اوبيراسيون|نشاط|تاريخ|الحركات/ },
        { id: 'archive',   rx: /ارشيف|فواتير قديمه?|المحفوظات|السجلات/ },
        { id: 'debts',     rx: /ديون|دين|دفتر الديون|دفتر|المديونيه?|الديون/ },
    ];

    /* ── استخراج الـ Intent من الجملة ── */
    function _extractIntent(t) {
        /* اكتشاف الفعل */
        let verb = 'unknown';
        for (const [v, rx] of Object.entries(_VERBS)) {
            if (rx && rx.test(t)) { verb = v; break; }
        }

        /* استخراج الأرقام */
        const nums = [...t.matchAll(/(\d[\d\s]*(?:[.,]\d+)?)/g)]
            .map(m => parseFloat(m[1].replace(/\s/g,'').replace(',','.')))
            .filter(n => !isNaN(n));

        /* استخراج وحدة النقل */
        const unitM = t.match(/\b(\d[\d.,\s]*)\s*(غرام|غ\b|لانجو|لانقو|لانغو|كيلو|kg|دينار|دج|دولار|\$)\b/);
        const amount = unitM ? parseFloat(unitM[1].replace(/\s/g,'').replace(',','.')) : (nums[0] || null);
        const unit   = unitM ? unitM[2] : null;

        /* استخراج العيار */
        const kM = t.match(/(?:عيار|قيراط|عير|كارا)\s*(\d{3,4})|(?:ذهب|سبيكه?)\s*(\d{3,4})/);
        const karat = kM ? parseInt(kM[1] || kM[2]) : null;

        /* استخراج العملة */
        const currency = /دينار|دج\b/.test(t) ? 'دينار'
                       : /دولار|\$/.test(t)   ? 'دولار'
                       : /ذهب 730|730/.test(t)? 'ذهب 730'
                       : /ذهب 24|24 قيراط/.test(t) ? 'ذهب 24'
                       : null;

        /* استخراج اسم الزبون — يُجرَّب مقابل قاعدة البيانات */
        let customer = null;
        /* كلمات شائعة لا تكون أسماء */
        const _STOP = new Set(['دفع','سلم','اعطى','اعطا','ارسل','جاب','ودع','بعث','حول','خلص','استلم',
            'اخذ','اخد','خدا','خدى','خذ','خد','ياخذ',
            'قبض','دينار','دولار','غرام','كيلو','عيار','مليون','مليار','الف','من','مع','في',
            'الى','على','عند','لي','لك','له','ان','كان','هو','هي','نعم','لا','قال']);
        const _isArName = w => /^[\u0621-\u064A\u0671]{2,}$/.test(w) && !_STOP.has(w);

        /* P1: اسم قبل الفعل — "صلاح دفع 5000" | "عبد الرحمن سلم" | "صلاح اخذ 300" */
        const beforeVerbM = t.match(/^([\u0621-\u064A\u0671]{2,}(?:\s+[\u0621-\u064A\u0671]{2,})?)\s+(?:دفع|سلم|اعطى|اعطا|ارسل|جاب|ودع|بعث|حول|خلص|استلم|قبض|اخذ|اخد|خدا|خدى|ياخذ)/);
        if (beforeVerbM) {
            const mr = _matchName(beforeVerbM[1].trim());
            if (mr.ok) customer = mr.name;
        }

        /* P2: بعد كلمات دلالية — "حساب صلاح" | "من أحمد" | "لـ محمد علي" */
        if (!customer) {
            const custHintM = t.match(
                /(?:حساب|رصيد|تصفيه?|صفّي|صفي|خلص|مع|عند|من|الى|ل )\s+([\u0621-\u064A\u0671]{2,}(?:\s+[\u0621-\u064A\u0671]{2,})?)/
            );
            if (custHintM) {
                const mr = _matchName(custHintM[1].trim());
                if (mr.ok) customer = mr.name;
            }
        }

        /* P3: مسح الكلمات — أزواج (للأسماء الثنائية) ثم مفردة */
        if (!customer) {
            const words = t.split(/\s+/).filter(w => !_STOP.has(w) && _isArName(w));
            /* جرب الأزواج أولاً (عبد الرحمن، محمد علي...) */
            for (let i = 0; i < words.length - 1 && !customer; i++) {
                const pair = words[i] + ' ' + words[i + 1];
                const mr = _matchName(pair);
                if (mr.ok) customer = mr.name;
            }
            /* ثم المفردة */
            if (!customer) {
                for (const w of words) {
                    const mr = _matchName(w);
                    const maxDist = Math.max(1, Math.floor(w.length * 0.3));
                    if (mr.ok && (mr.dist === undefined || mr.dist <= maxDist)) { customer = mr.name; break; }
                }
            }
        }

        return { verb, customer, amount, unit, karat, currency, nums, raw: t };
    }

    /* ── استخراج صفحة التنقل من الجملة ── */
    function _extractPage(t) {
        for (const p of _PAGES) if (p.rx.test(t)) return p;
        return null;
    }

    /* ════════════ SELF-LEARNING — التعلم الذاتي ════════════ */
    let learnDB = { fails: [], aliases: {} };
    function _learnLoad() {
        try {
            const d = JSON.parse(localStorage.getItem('va_learn') || '{}');
            learnDB.fails   = Array.isArray(d.fails)                ? d.fails   : [];
            learnDB.aliases = (d.aliases && typeof d.aliases==='object') ? d.aliases : {};
        } catch(e) {}
    }
    function _learnSave() {
        /* احتفظ بآخر 40 فشل فقط */
        learnDB.fails = learnDB.fails.slice(0, 40);
        try { localStorage.setItem('va_learn', JSON.stringify(learnDB)); } catch(e) {}
    }

    /* أمثلة للاقتراح عند الفشل المتكرر */
    const _HINTS = [
        'روح الديون', 'روح الفاتوره', 'روح الرافيناج', 'روح الرئيسي',
        'حسابي', 'حساب فارس', 'عطيني حساب خالد',
        'عثمان دفع 5000 دينار', 'اعطيت خالد 2 لانقو',
        'شحن 4000 سعر 3.1', 'بيع سلعة طاهر 150000 سعر 24800',
        'صفي فارس', 'فاتوره بيع لفارس', 'فاتوره شراء لاحمد',
        'احسبلي دبي شحن 3700 مصاريف 6000 دولار 24750',
        'عرض المخزون', 'مساعده',
    ];

    function _logFail(raw) {
        learnDB.fails.unshift({ t: raw, ts: Date.now() });
        _learnSave();
        /* فشلان في أقل من دقيقتين → اقترح أقرب مثال */
        const recentCnt = learnDB.fails.filter(f => Date.now() - f.ts < 120000).length;
        if (recentCnt >= 2) {
            const nt = _norm(raw);
            let best = null, bestD = Infinity;
            _HINTS.forEach(h => {
                const d = _lev(nt.slice(0, h.length + 4), h);
                if (d < bestD) { bestD = d; best = h; }
            });
            const close = bestD <= Math.max(3, Math.floor(nt.length * 0.45));
            const sug = close
                ? `\nأقصد مثلاً: "${best}"؟`
                : '\nعلّمني: "علمني [جملتك] يعني [أمر]"';
            return respond(`ما فهمتش 🤔${sug}`);
        }
        respond('ما فهمتش 🤔 — قل "مساعده" للأوامر');
    }

    /* ════════════ FUZZY MATCH ════════════ */
    function _lev(a, b) {
        const m = a.length, n = b.length;
        if (!m) return n; if (!n) return m;
        const R = Array.from({length: m + 1}, (_, i) => [i]);
        for (let j = 1; j <= n; j++) R[0][j] = j;
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                R[i][j] = a[i-1] === b[j-1] ? R[i-1][j-1]
                    : 1 + Math.min(R[i-1][j], R[i][j-1], R[i-1][j-1]);
        return R[m][n];
    }

    /* let-variables في app.js لا تُضاف لـ window — نستخدم typeof guard */
    function _gl(name) {
        try { const v = (new Function('return typeof '+name+' !== "undefined" ? '+name+' : []'))(); return Array.isArray(v)?v:[]; } catch(e){return[];}
    }
    function _allNames() {
        const s = new Set();
        _gl('debts')        .forEach(d => d.c && s.add(d.c));
        _gl('invoices')     .forEach(i => i.c && s.add(i.c));
        _gl('dollInvoices') .forEach(i => i.c && s.add(i.c));
        _gl('rafInvoices')  .forEach(i => i.c && s.add(i.c));
        _gl('dubaiInvoices').forEach(i => { if(i.c)s.add(i.c); if(i.o)s.add(i.o); });
        _gl('loans')        .forEach(l => l.c && s.add(l.c));
        _gl('ops')          .forEach(o => o.c && s.add(o.c));
        return [...s].filter(Boolean);
    }

    /* تطبيع للمقارنة فقط: همزة/تاء مربوطة/ألف مقصورة/تشكيل/مسافات */
    function _normName(s){
        return (s||'').trim()
            .replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي')
            .replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ء/g,'')
            .replace(/[\u064B-\u0652\u0670]/g,'').replace(/\s+/g,' ').split(' ').map(w=>w.replace(/^(ال|لل|ل|ا)/,'')).join(' ').replace(/ا/g,'');
    }
    function _matchName(spoken) {
        spoken = (spoken || '').trim();
        if (!spoken) return {name: spoken, ok: false};
        if (nameMap[spoken]) return {name: nameMap[spoken], ok: true, learned: true};

        const names = _allNames();
        if (!names.length) return {name: spoken, ok: false};

        const sp = _normName(spoken);
        /* ① تطابق تام بعد التطبيع (تجريد التعريف + إسقاط الألف) */
        const exact = names.find(n => _normName(n) === sp);
        if (exact) return {name: exact, ok: true};
        /* ② تسامح متدرج: مسافة 1 دائماً، ومسافة 2 للأسماء الطويلة (≥6 بعد التطبيع)
           — أضيق من الضبابية القديمة كي لا تُطابَق كلمات عامة كأسماء */
        let best=null,bestD=Infinity;
        names.forEach(n=>{const d=_lev(sp,_normName(n));if(d<bestD){bestD=d;best=n;}});
        const lim=(sp.length>=6&&_normName(best||'').length>=6)?2:1;
        if(best&&bestD<=lim&&sp.length>=3)
            return {name:best,ok:true,dist:bestD,candidates:names};
        return {name: spoken, ok: false, candidates: names};
    }

    /* ════════════ PAGE DETECTOR ════════════ */
    function _getPage() {
        const a = document.querySelector('.page.active');
        return a ? a.id.replace('page-', '') : 'home';
    }

    /* ════════════ INTENT ROUTER — القلب الجديد ════════════
       يستقبل الجملة، يُصنّف النية، يوجّه للدالة الصحيحة.
       لا يوجد "ما فهمتك" قبل محاولة السياق والتوضيح.
    ═══════════════════════════════════════════════════════ */
    function parse(raw, _silent) {
        const t = _norm(raw);
        if (!t) return false;

        /* ══ الفائدة/الحصيلة — أولوية قصوى قبل أي نية أخرى ══ */
        if(/(فايده|حصيله|ربح|ارباح|مربوح)/.test(t.replace(/[إأآٱ]/g,'ا').replace(/[ؤئ]/g,'ي').replace(/ء/g,'').replace(/ى/g,'ي').replace(/ة/g,'ه'))||/مد ?لي الفا/.test(t)){
            const isMonth=/(شهر|شهري)/.test(t.replace(/ة/g,'ه'))||/مد ?لي الفا/.test(t);
            try{ if(isMonth&&window.showMonthlyProfit)showMonthlyProfit(); else if(window.showPeriodSummary)showPeriodSummary('day'); respond(isMonth?'📈 فائدة الشهر':'📊 حصيلة اليوم'); }catch(e){}
            return true;
        }

        /* ── 1. aliases المتعلَّمة ── */
        for (const [phrase, cmd] of Object.entries(learnDB.aliases || {})) {
            const np = _norm(phrase);
            if (!np) continue;
            if (t === np || t.startsWith(np+' ') || t.includes(' '+np+' ') || t.endsWith(' '+np))
                return parse(t.replace(np, cmd), _silent);
        }

        /* ── 2. حل الأمر المعلَّق (multi-step pending) ── */
        if (_pendingCmd) {
            const pend = _pendingCmd;
            if (/^(?:نعم|ايه|ايوا|اه|يزي|واه|صح|موافق|تمام|كمل|بلا|هو|اكيد|تاكد|طبعا|بالتاكيد)$/.test(t)) {
                _pendingCmd = null;
                if (SessionContext.lastActiveCustomer) {
                    respond(`واه — ${SessionContext.lastActiveCustomer} ✅`);
                    return _routePendingAction(pend, SessionContext.lastActiveCustomer);
                }
                respond('قول اسم الزبون كامل');
                return true;
            }
            if (/^(?:لا|لاء|لالا|الغي|لا تكمل|ما نبي|لا شكرا|توقف|بطل|ارجع)$/.test(t)) {
                _pendingCmd = null;
                respond('مزيان، ألغينا ✅');
                return true;
            }
            /* قال اسماً مباشرةً */
            const pR = _matchName(t);
            if (pR.ok) {
                _pendingCmd = null;
                if (pR.dist > 0) learnName(t, pR.name);
                SessionContext.setCustomer(pR.name);
                return _routePendingAction(pend, pR.name);
            }
            _pendingCmd = null; /* جملة غير معروفة — تجاهل الانتظار */
        }

        /* ── 3. استخلاص النية ── */
        const intent = _extractIntent(t);
        const pg = _getPage();

        /* ══════════════════════════════
           ROUTING بحسب الـ VERB
        ══════════════════════════════ */

        /* HELP */
        if (intent.verb === 'help') { _help(); return true; }

        /* TTS */
        if (intent.verb === 'tts') { toggleTts(); return true; }

        /* LEARN — "علمني X يعني Y" */
        if (intent.verb === 'learn') {
            const lm = t.match(/^(?:علمني|تعلم|احفظ|سجل)\s+(.{2,}?)\s+(?:يعني|مثل|زي|هو|تعني)\s+(.{2,})$/);
            if (lm) {
                learnDB.aliases[lm[1].trim()] = lm[2].trim();
                _learnSave();
                respond(`تعلمت ✅ — من الآن "${lm[1].trim()}" تعني "${lm[2].trim()}"`);
                return true;
            }
        }

        /* NAVIGATE — انتقال للصفحة */
        if (intent.verb === 'navigate') {
            const pg2 = _extractPage(t);
            if (pg2) { _nav(pg2.id, pg2.id); return true; }
            /* لم يُحدَّد الوجهة — اسأل */
            return _askClarify('أين تريد أن تذهب؟', [
                {label:'الرئيسية', act:()=>_nav('home','الرئيسية')},
                {label:'الفاتورة', act:()=>_nav('invoice','الفاتورة')},
                {label:'الديون',   act:()=>_nav('debts','الديون')},
                {label:'الرافيناج',act:()=>_nav('raffinage','الرافيناج')},
                {label:'السجل',    act:()=>_nav('log','السجل')},
            ]), true;
        }

        /* MYBAL — رصيدي */
        if (intent.verb === 'mybal') { _myBalance(); return true; }

        /* INVENTORY — المخزون */
        if (intent.verb === 'inventory') { _inventory(); return true; }

        /* RAFSAVE — تحويل مباشر مع حفظ */
        if (intent.verb === 'rafsave') { _rafAllAndSave(); return true; }

        /* RAFMOVE — نقل السبائك للرافيناج */
        if (intent.verb === 'rafmove') { _rafAll(); return true; }

        /* ANALYTICS */
        if (intent.verb === 'myweek')   { _weeklyRevenue();  return true; }
        if (intent.verb === 'mymonth')  { _monthlyRevenue(); return true; }
        if (intent.verb === 'buysum')   { _buySummary(intent.raw);    return true; }
        if (intent.verb === 'activity') { _activityReport(intent.raw); return true; }
        if (intent.verb === 'alldebts') { _totalDebts();     return true; }

        /* DUBAI CALC */
        if (intent.verb === 'dubai') {
            const _pn = s => s ? parseFloat((s||'').replace(/\s/g,'').replace(',','.')) : null;
            const shipM = t.match(/(?:شحن|الشحن)\s*:?\s*(\d[\d\s]*(?:[.,]\d+)?)/);
            const expM  = t.match(/(?:مصاريف|مصروف)\s*:?\s*(\d[\d\s]*(?:[.,]\d+)?)/);
            const dolM  = t.match(/(?:الدولار|دولار|الدلار|دلار)\s*:?\s*(\d[\d\s]*(?:[.,]\d+)?)/);
            const discM = t.match(/(?:خصم|الخصم)\s*:?\s*(\d[\d\s]*(?:[.,]\d+)?)/);
            _dubaiCalc(_pn(shipM?.[1]), _pn(expM?.[1]), _pn(dolM?.[1]), _pn(discM?.[1]));
            return true;
        }

        /* CUSTBAL — حساب زبون */
        if (intent.verb === 'custbal') {
            /* جرّب اسم الزبون المستخلَص أو اسأل */
            return _withCustomer(t, intent.customer,
                n => { SessionContext.setCustomer(n); _custBalance(n); },
                'عرض حساب'), true;
        }

        /* SETTLE — تصفية */
        if (intent.verb === 'settle') {
            /* "عثمان خلص دينه" → استخرج السياق لأول زبون يطابق */
            const custRaw = _extractCustFromSettle(t);
            return _withCustomer(t, custRaw || intent.customer,
                n => { SessionContext.setCustomer(n); _settle(n); },
                'تصفية'), true;
        }

        /* INVOICE — فاتورة بيع/شراء */
        if (intent.verb === 'invoice') {
            const isBuy = /شراء|شرا|اشتريت|شريت|اشتري/.test(t);
            const type  = isBuy ? 'buy' : 'sell';
            return _withCustomer(t, intent.customer,
                n => { SessionContext.setCustomer(n); _openInv(type, n); },
                `فاتورة ${isBuy?'شراء':'بيع'}`), true;
        }

        /* صفحة الرافيناج — إدخال رقمي مباشر */
        if (pg === 'raffinage' && /\d+(?:[.,]\d+)?\s*(?:غ\b|غرام)|(?:عيار|قيراط|عير|ك)\s*\d/.test(t)) {
            window._applyVoice && _applyVoice(t, 'raf');
            respond('✅ ضفنا السطر فالرافيناج');
            return true;
        }

        /* صفحة الفاتورة — إدخال رقمي مباشر */
        if (pg === 'invoice' && /\d+(?:[.,]\d+)?\s*(?:غ\b|غرام)|(?:عيار|قيراط|عير)\s*\d/.test(t)) {
            window._applyVoice && _applyVoice(t, 'inv');
            respond('✅ ضفنا السطر فالفاتورة');
            return true;
        }

        /* TRANSFER / SHIPPING / DOLLAR / EXPENSES — عمليات الصفحة الرئيسية */
        if (intent.verb === 'transfer' || intent.verb === 'shipping' ||
            intent.verb === 'dolbuy'   || intent.verb === 'expenses') {
            if (intent.customer) SessionContext.setCustomer(intent.customer);
            window._applyHomeVoice && _applyHomeVoice(t);
            return true;
        }

        /* ══ fallback: أمر ناقص — فعل + مقدار بلا زبون ══ */
        if (intent.amount && intent.unit && !intent.customer) {
            /* هل الجملة تبدو كتحويل؟ */
            const looksLikeTransfer = /اعطيت|سلمت|دفعت|وزعت|عطيت|ارسلت|استلمت|قبضت/.test(t);
            if (looksLikeTransfer) {
                if (SessionContext.lastActiveCustomer) {
                    _pendingCmd = { action: 'transfer', raw: t, amount: intent.amount, unit: intent.unit };
                    respond(`قصدك ${SessionContext.lastActiveCustomer}؟ — قل "ايه" أو اسم الزبون`);
                    return true;
                }
                respond(_smartSuggest(t));
                return true;
            }
        }

        /* ══ آخر محاولة: لو في سياق زبون وجملة قصيرة → اقترح ══ */
        if (SessionContext.lastActiveCustomer && t.split(' ').length <= 3) {
            return _smartFallback(t, intent), true;
        }

        /* فشل نهائي */
        if (!_silent) _logFail(raw);
        return false;
    }

    /* ═════ دوال مساعدة للـ Router ═════ */

    /* استخراج اسم الزبون من جملة التصفية ("عثمان خلص دينه") */
    function _extractCustFromSettle(t) {
        const m = t.match(/^([\u0621-\u064A\u06700-9]{2,}(?:\s+[\u0621-\u064A\u06700-9]{2,})?)\s+(?:خلص|سدد|اغلق|اقفل|صفا|قضى|قضا)/);
        return m ? m[1].trim() : null;
    }

    /* تنفيذ الأمر المعلَّق بعد تأكيد الزبون */
    function _routePendingAction(pend, name) {
        if (pend.action === 'transfer') {
            /* أعد التوجيه لـ _applyHomeVoice مع الاسم */
            const synth = pend.raw.replace(
                /^(اعطيت|سلمت|دفعت|وزعت|عطيت|ارسلت)\s+/,
                `$1 ${name} `
            );
            window._applyHomeVoice && _applyHomeVoice(synth);
            respond(`واه — ${name} ✅`);
            return true;
        }
        if (pend.action === 'settle')   { _settle(name); return true; }
        if (pend.action === 'custbal')  { _custBalance(name); return true; }
        if (pend.action === 'invbuy')   { _openInv('buy',  name); return true; }
        if (pend.action === 'invsell')  { _openInv('sell', name); return true; }
        return false;
    }

    /* تنفيذ عملية مع زبون — إذا ما وُجد الاسم يسأل أو يُعلَّق */
    function _withCustomer(t, custRaw, action, label) {
        if (custRaw) {
            const res = _matchName(custRaw);
            if (res.ok) {
                if (res.dist > 0) learnName(custRaw, res.name);
                action(res.name);
                return true;
            }
            if (res.candidates && res.candidates.length)
                return _askPick(custRaw, res.candidates, n => { SessionContext.setCustomer(n); action(n); }), true;
        }
        /* لا اسم — هل في سياق زبون؟ */
        if (SessionContext.lastActiveCustomer) {
            _pendingCmd = { action: label, raw: t };
            respond(`قصدك ${SessionContext.lastActiveCustomer}؟ — قل "ايه" أو اسم الزبون`);
            return true;
        }
        /* لا سياق — اعرض قائمة الزبائن المعروفين */
        const allN = _allNames().slice(0, 6);
        if (allN.length) return _askPick('', allN, action), true;
        respond(`قول اسم الزبون — مثلاً: "${label} يسين"`);
        return true;
    }

    /* اقتراح ذكي عند فشل نهائي */
    function _smartSuggest(t) {
        const cx = SessionContext.lastActiveCustomer;
        if (cx) return `قول اسم الزبون ولا "ايه" إذا قصدك ${cx}`;
        const names = _allNames();
        if (names.length) return `قول اسم الزبون — مثلاً: ${names.slice(0,2).join(' أو ')}`;
        return 'ما فهمتك — قل "مساعده" لترى الأوامر';
    }

    /* fallback ذكي لجمل قصيرة في سياق زبون */
    function _smartFallback(t, intent) {
        const cx = SessionContext.lastActiveCustomer;
        /* جملة من كلمة واحدة = اسم زبون محتمل */
        const res = _matchName(t);
        if (res.ok) { SessionContext.setCustomer(res.name); _custBalance(res.name); return true; }
        /* اقترح: ربما يريد حساب الزبون الأخير */
        _pendingCmd = { action: 'custbal', raw: t };
        respond(`تبغي حساب ${cx}؟ — قل "ايه" أو وضح`);
        return true;
    }

    /* بطاقة توضيح مع خيارات (clarification card) */
    function _askClarify(question, choices) {
        showCard(`
        <div class="va-card-title" style="margin-bottom:.7rem">${question}</div>
        <div style="display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center">
            ${choices.map(c=>`<button class="va-card-btn va-card-btn-gold" onclick="(${c.act.toString()})();closeCard()">${c.label}</button>`).join('')}
        </div>
        <div style="text-align:center;margin-top:.6rem"><button class="va-card-btn va-card-btn-red" onclick="closeCard()">إلغاء</button></div>`);
        respond(question);
    }

    /* ════════════ ACTIONS ════════════ */
    function _nav(page, label) {
        window.switchPage && switchPage(page);
        respond(`تفضل — ${label} ✅`);
    }

    function _custBalance(name) {
        const di  = window.getCustBal ? getCustBal(name, 'دينار')   : 0;
        const g7  = window.getCustBal ? getCustBal(name, 'ذهب 730') : 0;
        const g2  = window.getCustBal ? getCustBal(name, 'ذهب 24')  : 0;
        const dol = window.getCustBal ? getCustBal(name, 'دولار')   : 0;
        const _s  = (v, d=0, u='') => {
            if (Math.abs(v) < 0.001) return `<span style="color:var(--t3)">—</span>`;
            const col = v > 0 ? '#16a34a' : '#ef4444';
            return `<span style="color:${col};font-weight:800">${v > 0 ? '+' : ''}${d ? v.toFixed(d) : Math.round(v).toLocaleString('fr-DZ')} ${u}</span>`;
        };
        showCard(`
        <div class="va-card-title">${name}</div>
        <div class="va-card-sub">حساب الزبون — موجب = يسالك</div>
        <div class="va-bal-grid">
            <div class="va-bal-cell"><span class="va-bal-lbl">💵 دينار</span>${_s(di,0,'DZD')}</div>
            <div class="va-bal-cell"><span class="va-bal-lbl">🥇 سلعة</span>${_s(dol,2,'غ')}</div>
            <div class="va-bal-cell"><span class="va-bal-lbl">👑 ذهب 730</span>${_s(g7,2,'غ')}</div>
            <div class="va-bal-cell"><span class="va-bal-lbl">💎 ذهب 24</span>${_s(g2,2,'غ')}</div>
        </div>
        <div style="display:flex;gap:.5rem;margin-top:.8rem;justify-content:center">
            <button class="va-card-btn va-card-btn-gold" onclick="VA.settle('${name.replace(/'/g,"\\'")}');closeCard()">تصفية</button>
            <button class="va-card-btn va-card-btn-red" onclick="closeCard()">إغلاق</button>
        </div>`);
        const diTxt = Math.abs(di) > 0.001 ? (di > 0 ? `يسالك ${Math.round(di).toLocaleString()} دج` : `تسالو ${Math.round(-di).toLocaleString()} دج`) : 'رصيد صفر';
        respond(`حساب ${name}: ${diTxt}`);
    }

    function _myBalance() {
        let B; try { B = (new Function('return typeof B!=="undefined"?B:{}'))(); } catch(e){B={};} if(typeof B!=='object'||!B)B={};
        showCard(`
        <div class="va-card-title">رصيدك الحالي</div>
        <div class="va-bal-grid">
            <div class="va-bal-cell"><span class="va-bal-lbl">💵 السيولة</span><span style="color:var(--bl);font-weight:800">${((B['دينار']||0)).toLocaleString('fr-DZ')} DZD</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">💲 دولار</span><span style="color:var(--gr);font-weight:800">${(B['دولار']||0).toFixed(2)} $</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">👑 ذهب 730</span><span style="color:var(--g400);font-weight:800">${(B['ذهب 730']||0).toFixed(2)} غ</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">💎 ذهب 24</span><span style="color:var(--pu);font-weight:800">${(B['ذهب 24']||0).toFixed(2)} غ</span></div>
        </div>
        <div style="text-align:center;margin-top:.8rem"><button class="va-card-btn va-card-btn-red" onclick="closeCard()">إغلاق</button></div>`);
        respond(`عندك ${((B['دينار']||0)).toLocaleString('fr-DZ')} دج و ${(B['ذهب 730']||0).toFixed(1)} غرام ذهب 730`);
    }

    function _dubaiCalc(ship, expenses, dollar, disc) {
        window.openDubaiCalc && openDubaiCalc();
        setTimeout(() => {
            if (ship     !== null && ship     !== undefined) document.getElementById('dcShip').value     = ship;
            if (expenses !== null && expenses !== undefined) document.getElementById('dcExpenses').value = expenses;
            if (dollar   !== null && dollar   !== undefined) document.getElementById('dcDollar').value   = dollar;
            if (disc     !== null && disc     !== undefined) document.getElementById('dcDisc').value     = disc;
            window.calcDubaiSell && calcDubaiSell();
            setTimeout(() => {
                const res = document.getElementById('dcResult');
                const txt = res ? res.innerText.replace(/سعر الشاشة.*\n?/,'').trim() : '';
                respond(txt ? `سعر البيع دبي: ${txt} ✅` : 'وقعنا الحساب ✅');
            }, 150);
        }, 350);
    }

    function _inventory() {
        const b730 = _gl('g730'), b24 = _gl('g24');
        const w730 = b730.reduce((s,b) => s+(b.w||0), 0);
        const w24  = b24.reduce((s,b)  => s+(b.w||0), 0);
        showCard(`
        <div class="va-card-title">المخزون الحالي</div>
        <div class="va-bal-grid">
            <div class="va-bal-cell"><span class="va-bal-lbl">👑 ذهب 730</span><span style="color:var(--g400);font-weight:800">${b730.length} سبيكة<br><small style="font-weight:500;color:var(--t2)">${w730.toFixed(1)} غ</small></span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">💎 ذهب 24</span><span style="color:var(--pu);font-weight:800">${b24.length} سبيكة<br><small style="font-weight:500;color:var(--t2)">${w24.toFixed(1)} غ</small></span></div>
        </div>
        <div style="text-align:center;margin-top:.8rem"><button class="va-card-btn va-card-btn-red" onclick="closeCard()">إغلاق</button></div>`);
        respond(`عندك ${b730.length} سبيكة 730 بـ ${w730.toFixed(1)} غرام`);
    }

    /* ════════════ PROACTIVE ALERTS — التنبيهات الاستباقية ════════════
       تُشغَّل تلقائياً بعد 3.5 ثانية من الفتح لفحص ديون الزبائن          */
    function checkProactiveAlerts() {
        try {
            const allDebts = _gl('debts');
            if (!allDebts.length) return;

            /* اجمع ديون الدينار لكل زبون */
            const totals = {};
            allDebts.forEach(d => {
                if (d.type === 'دينار' && d.c && d.a) {
                    totals[d.c] = (totals[d.c] || 0) + d.a;
                }
            });

            /* زبائن تجاوز دينهم 500,000 دج مرتّبون تنازلياً */
            const high = Object.entries(totals)
                .filter(([, v]) => v > 500000)
                .sort((a, b) => b[1] - a[1]);

            if (!high.length) return;

            /* اعرض بطاقة التحذير */
            const rows = high.map(([n, v]) =>
                `<div class="va-bal-cell"><span class="va-bal-lbl">⚠️ ${n}</span>` +
                `<span style="color:#ef4444;font-weight:800">${Math.round(v).toLocaleString('fr-DZ')} DZD</span></div>`
            ).join('');
            showCard(`
            <div class="va-card-title" style="color:#ef4444">⚠️ تنبيه — ديون مرتفعة</div>
            <div class="va-card-sub">الزبائن الذين تجاوزت ديونهم 500,000 دج</div>
            <div class="va-bal-grid" style="margin-top:.6rem">${rows}</div>
            <div style="text-align:center;margin-top:.8rem">
                <button class="va-card-btn va-card-btn-red" onclick="closeCard()">حسناً</button>
            </div>`);

            /* النطق الصوتي — أول زبون فقط */
            const [topName, topVal] = high[0];
            const msg = `صاحبي — انتبه، ${topName} عندو دين كبير: ${Math.round(topVal / 1000)} ألف دينار`;
            respond(msg, true);
        } catch(e) {}
    }

    /* ════════════ ANALYTICS — تحليل الإيرادات ════════════ */

    /* مساعد: جلب ops وتصفيتها حسب النطاق الزمني */
    function _filterOps(fromTs) {
        return _gl('ops').filter(op => (op.dt || 0) >= fromTs);
    }
    /* مساعد: مجموع مبيعات الدينار */
    function _sumSells(ops) {
        return ops
            .filter(op => op.t === 'بيع' && op.m === 'دينار')
            .reduce((s, op) => s + (op.a || 0), 0);
    }
    /* مساعد: بناء بطاقة الإيرادات */
    function _revenueCard(title, ops) {
        const sellDzd  = _sumSells(ops);
        const buyCount = ops.filter(op => op.t === 'شراء').length;
        const sellCnt  = ops.filter(op => op.t === 'بيع').length;
        const custSet  = new Set(ops.map(op => op.c).filter(Boolean));
        showCard(`
        <div class="va-card-title">📊 ${title}</div>
        <div class="va-bal-grid">
            <div class="va-bal-cell"><span class="va-bal-lbl">💵 مبيعات</span>
                <span style="color:var(--g600);font-weight:800">${Math.round(sellDzd).toLocaleString('fr-DZ')} DZD</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">📦 بيع / شراء</span>
                <span style="color:var(--bl);font-weight:800">${sellCnt} / ${buyCount}</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">👥 زبائن</span>
                <span style="color:var(--pu);font-weight:800">${custSet.size}</span></div>
        </div>
        <div style="text-align:center;margin-top:.8rem">
            <button class="va-card-btn va-card-btn-red" onclick="closeCard()">إغلاق</button>
        </div>`);
        return sellDzd;
    }

    function _weeklyRevenue() {
        const from   = Date.now() - 7 * 24 * 3600 * 1000;
        const ops    = _filterOps(from);
        const total  = _revenueCard('إيرادات الأسبوع', ops);
        const msg    = total > 0
            ? `دخل هذا الأسبوع ${Math.round(total).toLocaleString('fr-DZ')} دينار`
            : 'ما كانش بيع هذا الأسبوع والله';
        respond(msg);
    }

    function _monthlyRevenue() {
        const now  = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const ops  = _filterOps(from);
        const total = _revenueCard('إيرادات الشهر', ops);
        const msg   = total > 0
            ? `دخل هذا الشهر ${Math.round(total).toLocaleString('fr-DZ')} دينار`
            : 'ما كانش بيع هذا الشهر والله';
        respond(msg);
    }

    /* ════════════ ملخّصات الشراء/البيع حسب الفترة ════════════ */
    function _detectPeriod(t){
        const now=Date.now(), s=String(t||'');
        /* النص هنا مُطبَّع (ة→ه، أ→ا). الأسبوع له كلمات مميّزة لا تتقاطع مع «شهر».
           يُفحص الأسبوع أولاً. يلتقط: السمانه/السيمانه/سمانا/الاسبوع/هالاسبوع/الجمعه */
        if(/(?:سمانه|سيمانه|سمانا|اسبوع|هالاسبوع|الجمعه|جمعه هذي)/.test(s)){
            /* بداية الأسبوع = آخر سبت (منتصف ليله). getDay: 0=أحد … 6=سبت */
            const w=new Date(); w.setHours(0,0,0,0);
            w.setDate(w.getDate()-((w.getDay()+1)%7));
            return {from:w.getTime(), label:'هذا الأسبوع'};
        }
        if(/شهر/.test(s)){
            const d=new Date(); return {from:new Date(d.getFullYear(),d.getMonth(),1).getTime(), label:'هذا الشهر'};
        }
        const d=new Date(); d.setHours(0,0,0,0);
        return {from:d.getTime(), label:'اليوم'};
    }

    /* يجمع الشراء/البيع (موزون بالوزن المعياري 730) خلال الفترة */
    /* يجمع الشراء/البيع خلال الفترة من أحداث العمليات الحقيقية فقط.
       يَعُدّ INVOICE_BUY للشراء، و INVOICE_SELL/SELL للبيع، ويستبعد تماماً:
       سجلّ HIST المُرحَّل (تواريخه تتجمّع حول وقت الترحيل فتُفسد الفترات)،
       والتصفيات (SETTLE_GSM…) التي ليست عمليات بيع/شراء، والأحداث المُبطَلة. */
    function _periodData(from){
        const evs=_gl('_allEvents');
        const voided=new Set();
        evs.forEach(e=>{ if(e&&e.type==='VOID'&&e.data&&e.data.voids) voided.add(e.data.voids); });
        const agg={buy:{w:0,d:0,n:0}, sell:{w:0,d:0,n:0}, dubai:{w:0,d:0,n:0}};
        evs.forEach(e=>{
            if(!e||voided.has(e.id)) return;
            /* بيع دبي: يدخل ضمن البيع بوزنه المكافئ 730 وقيمته بسعر الأرشيف */
            if(e.type==='DUBAI'){
                const dd=e.data||{}; const ts=(e.display&&e.display.op&&e.display.op._ts)||e.ts||0;
                if(ts<from) return;
                const w=+dd.w||0, eq=w/0.730;
                let pr=0; try{ const r=window._dubaiPerGram&&_dubaiPerGram(dd); pr=(r&&isFinite(r.pr))?r.pr:0; }catch(_){ }
                if(!pr){ const rate=+dd.rate||(typeof dollarRate!=='undefined'?dollarRate:0); pr=eq>0?(+dd.usd||0)*rate/eq/100:0; }
                agg.sell.n++; agg.sell.w+=eq; agg.sell.d+=eq*pr;
                agg.dubai.n++; agg.dubai.w+=eq; agg.dubai.d+=eq*pr;
                return;
            }
            let side=null;
            if(e.type==='INVOICE_BUY') side='buy';
            else if(e.type==='INVOICE_SELL'||e.type==='SELL') side='sell';
            if(!side) return;
            const op=(e.display&&e.display.op)||{};
            const ts=op._ts||e.ts||0;
            if(ts<from) return;
            const inv=(e.display&&e.display.invoice)||{};
            const items=inv.items||[];
            let w=items.reduce((s,it)=>s+(+it.eq730||+it.w||0),0); if(!w) w=+op.eq730||0;
            let dn=+inv.tp||0; if(!dn) dn=(+op.total||+op.a||0)||items.reduce((s,it)=>s+(+it.total||0),0);
            agg[side].n++; agg[side].w+=w; agg[side].d+=dn;
        });
        return agg;
    }

    /* المخزون المتبقّي الآن + متوسّط عياره */
    function _remainStock(){
        let w=0, kw=0;
        _gl('g730').forEach(b=>{ const bw=+b.w||0; w+=bw; kw+=bw*(+b.k||730); });
        _gl('g24').forEach(b=>{ const bw=+b.w||0; w+=bw; kw+=bw*(+b.k||1000); });
        return {w, avgK: w>0?kw/w:0};
    }
    /* الذهب المشحون غير المبيوع = أرصدة «ذهب 24» الموجبة لدى مكاتب دبي (مكافئ 730) */
    function _dubaiPendingGold(){
        const offices=new Set();
        _gl('dubaiInvoices').forEach(i=>{ if(i.o)offices.add(i.o); if(i.c)offices.add(i.c); });
        let eq=0;
        _gl('debts').forEach(d=>{
            if(d.type==='ذهب 24' && d.a>0.001 && offices.has(d.c)) eq += d.a*(1000/730); /* 24 خالص → مكافئ 730 */
        });
        return eq;
    }

    const _f=(x,d)=>{ try{ return (typeof fmt==='function')?fmt(x,d):Math.round(x).toLocaleString('fr-DZ'); }catch(e){ return Math.round(x); } };

    function _buySummary(t){
        const {from,label}=_detectPeriod(t);
        const a=_periodData(from).buy;
        const avg=a.w>0?a.d/a.w:0;
        showCard(`
        <div class="va-card-title">🛒 مشترياتي — ${label}</div>
        <div class="va-bal-grid">
            <div class="va-bal-cell"><span class="va-bal-lbl">📦 عدد عمليات الشراء</span>
                <span style="font-weight:800">${a.n}</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">⚖️ الوزن المُشترى (730)</span>
                <span style="color:var(--g600);font-weight:800">${_f(a.w,2)} غ</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">💰 القيمة الإجمالية</span>
                <span style="font-weight:800">${_f(a.d,0)} دج</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">📈 متوسط سعر الشراء</span>
                <span style="color:var(--bl);font-weight:800">${_f(avg,0)} دج/غ</span></div>
        </div>
        <div style="text-align:center;margin-top:.8rem">
            <button class="va-card-btn va-card-btn-red" onclick="closeCard()">إغلاق</button>
        </div>`);
        respond(a.n? `شريت ${label} ${_f(a.w,2)} غرام بمتوسط ${_f(avg,0)} دينار للغرام` : `ما شريت والو ${label}`);
    }

    function _activityReport(t){
        const {from,label}=_detectPeriod(t);
        const D=_periodData(from);
        const r=_remainStock();
        const pend=_dubaiPendingGold();
        const aB=D.buy.w>0?D.buy.d/D.buy.w:0, aS=D.sell.w>0?D.sell.d/D.sell.w:0;
        /* ميزان تقريبي: (مبيوع + معلّق عند دبي + متبقّي بالكوفر) − مشترى = فرق (افتتاحي/تكرير/فترة) */
        const gap=(D.sell.w+pend+r.w)-D.buy.w;
        showCard(`
        <div class="va-card-title">📊 نشاط ${label}</div>
        <div class="va-bal-grid">
            <div class="va-bal-cell"><span class="va-bal-lbl">🛒 شراء</span>
                <span style="font-weight:800">${_f(D.buy.w,2)} غ</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">📈 متوسط الشراء</span>
                <span style="color:var(--bl);font-weight:800">${_f(aB,0)} دج/غ</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">💵 بيع</span>
                <span style="font-weight:800">${_f(D.sell.w,2)} غ</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">📉 متوسط البيع</span>
                <span style="color:var(--g600);font-weight:800">${_f(aS,0)} دج/غ</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">🏦 المتبقّي بالمخزون</span>
                <span style="font-weight:800">${_f(r.w,2)} غ</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">🚢 مشحون عند دبي (غير مبيوع)</span>
                <span style="color:#0f766e;font-weight:800">${_f(pend,2)} غ</span></div>
            <div class="va-bal-cell"><span class="va-bal-lbl">👑 متوسّط عيار المتبقّي</span>
                <span style="color:var(--pu);font-weight:800">${_f(r.avgK,0)}</span></div>
        </div>
        ${D.dubai&&D.dubai.n?`<div style="font-size:.72rem;color:var(--t3);text-align:center;margin-top:.5rem">🏙️ منها دبي: ${D.dubai.n} فاتورة · ${_f(D.dubai.w,2)} غ (م.730) · بمتوسط ${_f(D.dubai.w>0?D.dubai.d/D.dubai.w:0,0)} دج/غ</div>`:''}
        <div style="font-size:.7rem;text-align:center;margin-top:.4rem;padding:.4rem;border-radius:8px;background:${Math.abs(gap)<50?'rgba(22,163,74,.08)':'rgba(234,179,8,.10)'}">
            ⚖️ ميزان: (بيع ${_f(D.sell.w,0)} + مشحون ${_f(pend,0)} + مخزون ${_f(r.w,0)}) − شراء ${_f(D.buy.w,0)} = <b>${gap>=0?'+':''}${_f(gap,0)} غ</b>
            <div style="color:var(--t3);font-size:.63rem;margin-top:.2rem">${Math.abs(gap)<50?'متوازن ✅':'الفرق = رصيد افتتاحي مبيوع + فاقد التكرير + ذهب من فترات سابقة'}</div>
        </div>
        <div style="text-align:center;margin-top:.8rem">
            <button class="va-card-btn va-card-btn-red" onclick="closeCard()">إغلاق</button>
        </div>`);
        respond(`${label}: شريت ${_f(D.buy.w,1)}غ بمتوسط ${_f(aB,0)}، وبعت ${_f(D.sell.w,1)}غ بمتوسط ${_f(aS,0)}، وبقي ${_f(r.w,1)}غ`);
    }

    function _totalDebts() {
        const allDebts = _gl('debts');
        let totalDzd = 0, totalDol = 0, totalG730 = 0, totalG24 = 0;
        let debtors = 0, creditors = 0;
        const custSet = new Set();
        allDebts.forEach(d => {
            if (!d.c || !d.a) return;
            custSet.add(d.c);
            if (d.type === 'دينار')    { totalDzd  += d.a; if (d.a > 0) debtors++; else creditors++; }
            if (d.type === 'دولار')   totalDol  += d.a;
            if (d.type === 'ذهب 730') totalG730 += d.a;
            if (d.type === 'ذهب 24')  totalG24  += d.a;
        });
        const fmt2 = (v, u) => `<span style="color:${v>0?'#ef4444':v<0?'#16a34a':'var(--t3)'};font-weight:800">`
            + (v>0?'+':'')+( Math.abs(v)<0.01 ? '—' : (u==='DZD'?Math.round(v).toLocaleString('fr-DZ'):v.toFixed(2)))+' '+u+'</span>';
        showCard(`
        <div class="va-card-title">📋 ملخص الديون</div>
        <div class="va-card-sub">موجب = يسالك | سالب = أنت تسال</div>
        <div class="va-bal-grid" style="margin-top:.6rem">
            <div class="va-bal-cell"><span class="va-bal-lbl">💵 دينار</span>${fmt2(totalDzd,'DZD')}</div>
            <div class="va-bal-cell"><span class="va-bal-lbl">🥇 سلعة</span>${fmt2(totalDol,'غ')}</div>
            <div class="va-bal-cell"><span class="va-bal-lbl">👑 ذهب 730</span>${fmt2(totalG730,'غ')}</div>
            <div class="va-bal-cell"><span class="va-bal-lbl">💎 ذهب 24</span>${fmt2(totalG24,'غ')}</div>
            <div class="va-bal-cell"><span class="va-bal-lbl">👥 زبائن</span>
                <span style="color:var(--bl);font-weight:800">${custSet.size}</span></div>
        </div>
        <div style="text-align:center;margin-top:.8rem">
            <button class="va-card-btn va-card-btn-red" onclick="closeCard()">إغلاق</button>
        </div>`);
        const dMsg = Math.abs(totalDzd) > 0.01
            ? (totalDzd > 0 ? `جملة ما يسالوك ${Math.round(totalDzd).toLocaleString('fr-DZ')} دج`
                             : `نتا تسال ${Math.round(-totalDzd).toLocaleString('fr-DZ')} دج`)
            : 'ما كاينش ديون دينار';
        respond(dMsg);
    }

    function _rafAll() {
        window.switchPage && switchPage('raffinage');
        setTimeout(() => {
            /* سبائك 730 فقط — بعيارها الحقيقي */
            const bars730 = (window.g730||[]).filter(b=>(b.w||0)>0.001);
            if (!bars730.length) { respond('⚠️ ما كاينش سبائك فالمخزون'); return; }

            /* صفّر الجدول أولاً ثم أضف صفوفاً كافية */
            if (window.initRafTable) initRafTable();
            const needed = bars730.length;
            while ((window.rafRows||0) < needed) {
                if (window.addRafRow) addRafRow();
                else break;
            }

            /* امْلأ كل صف بوزن وعيار السبيكة الحقيقيَّين */
            bars730.forEach((b, i) => {
                const wi = document.getElementById('rafW_'+(i+1));
                const ki = document.getElementById('rafK_'+(i+1));
                if (wi) { wi.value = b.w; wi.dispatchEvent(new Event('input')); }
                if (ki) { ki.value = (b.k||730); ki.dispatchEvent(new Event('input')); }
            });

            /* امسح الصفوف الزائدة */
            for (let r = bars730.length+1; r <= (window.rafRows||0); r++) {
                const wi=document.getElementById('rafW_'+r);
                const ki=document.getElementById('rafK_'+r);
                if(wi) wi.value='';
                if(ki) ki.value='';
            }

            if (window.calcRaf) calcRaf();
            respond(`✅ حملنا ${bars730.length} سبيكة من مخزون 730 — دير اسم المصفى والأجرة وحفظ`);
        }, 500);
    }

    function _rafAllAndSave() {
        const bars730 = (window.g730||[]).filter(b=>(b.w||0)>0.001);
        if (!bars730.length) { respond('⚠️ ما كاينش سبائك فالمخزون'); return; }

        const totalW   = bars730.reduce((s,b)=>s+(b.w||0),0);
        const totalEq  = bars730.reduce((s,b)=>s+(b.w||0)*((b.k||730)/1000),0);
        const custList = [...new Set((window.debts||[]).map(d=>d.c))].slice(0,10);

        showCard(`
        <div class="va-card-title" style="margin-bottom:.5rem">🔥 تحويل للرافيناج</div>
        <div class="va-card-sub" style="margin-bottom:.7rem">${bars730.length} سبيكة — مجموع ${(window.fmt?fmt(totalW,2):totalW.toFixed(2))} غ (خالص ${(window.fmt?fmt(totalEq,3):totalEq.toFixed(3))} غ24)</div>
        <div style="margin:.4rem 0">
            <label style="font-size:.7rem;color:var(--t2);display:block;margin-bottom:.2rem">👤 اسم المصفى</label>
            <input id="_rsVoiceCust" list="_rsVoiceCustDL" placeholder="الزبون / المصفى..."
                autocomplete="off"
                style="width:100%;padding:.38rem .5rem;border-radius:7px;border:1.5px solid var(--border);background:var(--card);color:var(--t);font-family:Tajawal,sans-serif;font-size:.8rem;box-sizing:border-box">
            <datalist id="_rsVoiceCustDL">${custList.map(n=>`<option value="${n}">`).join('')}</datalist>
        </div>
        <div style="margin:.4rem 0">
            <label style="font-size:.7rem;color:var(--t2);display:block;margin-bottom:.2rem">💰 الأجرة (دج/غ)</label>
            <input id="_rsVoiceFee" type="number" min="1" step="any" placeholder="مثال: 150"
                style="width:100%;padding:.38rem .5rem;border-radius:7px;border:1.5px solid var(--border);background:var(--card);color:var(--t);font-family:Tajawal,sans-serif;font-size:.8rem;box-sizing:border-box">
        </div>
        <div style="display:flex;gap:.4rem;margin-top:.65rem">
            <button class="va-card-btn va-card-btn-gold" style="flex:1" onclick="window._doRafSave()">🔥 حفظ مباشر</button>
            <button class="va-card-btn" onclick="(function(){closeCard();window.switchPage&&switchPage('raffinage');setTimeout(()=>{if(window._rafAll)_rafAll();},400);})()" style="flex:1;background:var(--bg2);color:var(--t);border:1.5px solid var(--border)">📝 فقط ملء</button>
            <button class="va-card-btn va-card-btn-red" onclick="closeCard()">إلغاء</button>
        </div>`);

        setTimeout(()=>document.getElementById('_rsVoiceCust')?.focus(), 200);

        window._doRafSave = () => {
            const cust = (document.getElementById('_rsVoiceCust')?.value||'').trim();
            const fee  = parseFloat(document.getElementById('_rsVoiceFee')?.value)||0;
            if (!cust) { if(window.toast) toast('أدخل اسم المصفى','error'); return; }
            if (fee<=0) { if(window.toast) toast('أدخل الأجرة (دج/غ)','error'); return; }
            closeCard();
            window.switchPage && switchPage('raffinage');
            setTimeout(() => {
                if (window.initRafTable) initRafTable();
                while ((window.rafRows||0) < bars730.length) {
                    if (window.addRafRow) addRafRow(); else break;
                }
                bars730.forEach((b,i) => {
                    const wi=document.getElementById('rafW_'+(i+1));
                    const ki=document.getElementById('rafK_'+(i+1));
                    if(wi){wi.value=b.w;wi.dispatchEvent(new Event('input'));}
                    if(ki){ki.value=(b.k||730);ki.dispatchEvent(new Event('input'));}
                });
                for(let r=bars730.length+1;r<=(window.rafRows||0);r++){
                    const wi=document.getElementById('rafW_'+r);
                    const ki=document.getElementById('rafK_'+r);
                    if(wi)wi.value='';if(ki)ki.value='';
                }
                const custEl=document.getElementById('rafCustomer');
                const feeEl =document.getElementById('rafFee');
                if(custEl){custEl.value=cust;custEl.dispatchEvent(new Event('input'));}
                if(feeEl) {feeEl.value=fee; feeEl.dispatchEvent(new Event('input'));}
                if(window.calcRaf) calcRaf();
                setTimeout(() => {
                    if (window.saveSimpleRaf) {
                        saveSimpleRaf();
                        respond(`✅ تم حفظ رافيناج ${cust} — ${bars730.length} سبيكة (${(window.fmt?fmt(totalW,2):totalW.toFixed(2))} غ)`);
                    }
                }, 300);
            }, 500);
        };
    }

    function _openInv(type, name) {
        window.switchPage && switchPage('invoice');
        setTimeout(() => {
            const custEl = document.getElementById('invCustomer');
            const typeEl = document.getElementById('invType');
            if (custEl) { custEl.value = name; custEl.dispatchEvent(new Event('input')); }
            if (typeEl) { typeEl.value = type; typeEl.dispatchEvent(new Event('change')); }
            if (window.calcInvTotals) calcInvTotals();
        }, 350);
        respond(`فتحنا فاتورة ${type === 'buy' ? 'شراء' : 'بيع'} للزبون ${name} ✅`);
    }

    function _settle(name) {
        if (window.openSettle) openSettle(name);
        respond(`فتحنا تصفية ${name} ✅`);
    }

    function _help() {
        showCard(`
        <div class="va-card-title" style="margin-bottom:.7rem">الأوامر المتاحة 🎤</div>
        <div style="font-size:.7rem;background:var(--bg2);border-radius:8px;padding:.4rem .6rem;margin-bottom:.5rem;color:var(--t2);text-align:center">
            ✅ يفهم الدارجة الجزائرية <b>والعربية الفصحى</b> معاً
        </div>
        <div class="va-help-grid">
            <div class="va-help-row"><span class="va-help-icon">🧭</span><div><b>التنقل</b><br>"روح الديون" | "اذهب إلى الفاتورة" | "افتح الرافيناج"</div></div>
            <div class="va-help-row"><span class="va-help-icon">📊</span><div><b>حسابي</b><br>"واش عندي" | "ما هو رصيدي" | "حسابي"</div></div>
            <div class="va-help-row"><span class="va-help-icon">👤</span><div><b>حساب زبون</b><br>"عطيني حساب فارس" | "ما هو حساب خالد"</div></div>
            <div class="va-help-row"><span class="va-help-icon">🤝</span><div><b>تسليم / استلام</b><br>"عثمان دفع 5000 دينار" | "استلمت من خالد 3000"</div></div>
            <div class="va-help-row"><span class="va-help-icon">🚢</span><div><b>شحن</b><br>"شحن 4000 سعر 3.1 مكتب خليل"</div></div>
            <div class="va-help-row"><span class="va-help-icon">🥇</span><div><b>سلعة</b><br>"بيع سلعة طاهر 150000 سعر 24800"</div></div>
            <div class="va-help-row"><span class="va-help-icon">📄</span><div><b>الفاتورة (من صفحتها)</b><br>"100 غ عيار 750 سعر 12000"</div></div>
            <div class="va-help-row"><span class="va-help-icon">🔥</span><div><b>الرافيناج (من صفحته)</b><br>"50 غ عيار 703"</div></div>
            <div class="va-help-row"><span class="va-help-icon">📦</span><div><b>المخزون</b><br>"عرض المخزون" | "انقل السبائك للرافيناج"</div></div>
            <div class="va-help-row"><span class="va-help-icon">🔥</span><div><b>تحويل مباشر للرافيناج</b><br>"حول لرافيناج" ← يملأ + يحفظ فوراً</div></div>
            <div class="va-help-row"><span class="va-help-icon">📋</span><div><b>فتح فاتورة</b><br>"فاتورة بيع لفارس" | "إنشاء فاتورة شراء لأحمد"</div></div>
            <div class="va-help-row"><span class="va-help-icon">💰</span><div><b>التصفية</b><br>"صفي فارس" | "اعمل تصفية خالد"</div></div>
            <div class="va-help-row"><span class="va-help-icon">🏙️</span><div><b>حاسبة دبي</b><br>"احسبلي دبي شحن 3700 مصاريف 6000 دولار 24750"</div></div>
            <div class="va-help-row"><span class="va-help-icon">📈</span><div><b>تحليل الإيرادات</b><br>"شحال دخلنا هذا الأسبوع؟" | "شحال ربحنا هذا الشهر؟"</div></div>
        <div class="va-help-row"><span class="va-help-icon">📋</span><div><b>ملخص الديون</b><br>"شحال الديون؟" | "اجمالي الديون"</div></div>
        <div class="va-help-row" style="background:rgba(245,158,11,.08);border-radius:8px;padding:.3rem .4rem"><span class="va-help-icon">🧠</span><div><b>علمني أمراً جديداً</b><br>"علمني <i>قبضت</i> يعني <i>دفع</i>" | "علمني <i>باكي</i> يعني <i>روح الديون</i>"</div></div>
        <div class="va-help-row" style="background:rgba(239,68,68,.07);border-radius:8px;padding:.3rem .4rem"><span class="va-help-icon">🤖</span><div><b>سياق الحوار</b><br>بعد التعامل مع زبون، قل "اعطيت 50 غرام" وسأسألك "هل تقصد [الزبون]؟"</div></div>
        </div>
        <div style="font-size:.65rem;color:var(--t3);text-align:center;margin-top:.5rem">Alt+V لتشغيل الميكروفون من لوحة المفاتيح</div>
        <div style="text-align:center;margin-top:.5rem"><button class="va-card-btn va-card-btn-red" onclick="closeCard()">إغلاق</button></div>`);
        respond('هاهي الأوامر 🎤 — يفهم الدارجة والفصحى');
    }

    /* ── Confirm ambiguous name ── */
    function _askPick(spoken, candidates, cb) {
        _pickCb = cb;
        const list = (candidates || []).slice(0, 6);
        if (!list.length) return respond(`ما لقيتش زبون اسمه "${spoken}"`);
        showCard(`
        <div class="va-card-title" style="margin-bottom:.6rem">قصدك مِن هؤلاء؟</div>
        ${list.map(n => `<button class="va-pick-btn" onclick="VA.pickName('${n.replace(/'/g,"\\'")}','${spoken.replace(/'/g,"\\'")}')">${n}</button>`).join('')}
        <div style="text-align:center;margin-top:.6rem"><button class="va-card-btn va-card-btn-red" onclick="closeCard()">إلغاء</button></div>`);
    }

    function pickName(actual, spoken) {
        learnName(spoken, actual);
        closeCard();
        if (_pickCb) { _pickCb(actual); _pickCb = null; }
    }

    /* settle from card */
    function settle(name) { _settle(name); }

    /* ════════════ INFO CARD ════════════ */
    function showCard(html) {
        closeCard();
        const ov = document.createElement('div');
        ov.id = 'vaCardOverlay';
        ov.innerHTML = `<div class="va-card" id="vaCard">${html}</div>`;
        ov.addEventListener('click', e => { if (e.target === ov) closeCard(); });
        document.body.appendChild(ov);
        requestAnimationFrame(() => ov.classList.add('va-card-show'));
    }

    window.closeCard = function() {
        const ov = document.getElementById('vaCardOverlay');
        if (!ov) return;
        ov.classList.remove('va-card-show');
        setTimeout(() => ov.remove(), 280);
    };

    /* ════════════ RESPONSE ════════════ */
    function respond(text, speak = true) {
        const el = document.getElementById('vaResponse');
        if (el) {
            el.textContent = text;
            el.style.opacity = '1';
            clearTimeout(el._t);
            el._t = setTimeout(() => { el.style.opacity = '0'; }, 6000);
        }
        if (speak && ttsOn && 'speechSynthesis' in window) {
            speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'ar-DZ'; u.rate = 0.95; u.pitch = 1.1;
            speechSynthesis.speak(u);
        }
    }

    /* ════════════ SPEECH RECOGNITION ════════════ */
    function startListen() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            return _showBrowserWarn();
        }
        if (isListening) { stopListen(); return; }

        recog = new SR();
        recog.lang = 'ar-DZ';
        recog.continuous    = false;
        recog.interimResults= true;
        recog.maxAlternatives = 3;

        recog.onstart = () => {
            isListening = true;
            _setUI(true);
            _setTranscript('🎙️ جاري الاستماع…');
            respond('');
        };

        recog.onresult = e => {
            const res   = e.results[e.resultIndex];
            const isFin = res.isFinal;
            _setTranscript(res[0].transcript);
            if (isFin) {
                /* اجمع كل البدائل (حتى 3) وجرّبها بالترتيب */
                const alts = [];
                for (let i = 0; i < res.length; i++) alts.push(res[i].transcript);
                setTimeout(() => {
                    for (const alt of alts) {
                        if (parse(alt, true)) return;   /* نجح — توقف */
                    }
                    _logFail(alts[0]);                  /* كلها فشلت */
                }, 80);
            }
        };

        recog.onerror = e => {
            isListening = false;
            _setUI(false);
            const msgs = {
                'no-speech'  : 'ما سمعتك — عاود مرة',
                'not-allowed': 'الميكروفون موقوف — فعّله من إعدادات المتصفح',
                'network'    : 'مشكلة فالاتصال'
            };
            respond(msgs[e.error] || `خطأ: ${e.error}`);
        };

        recog.onend = () => {
            isListening = false;
            _setUI(false);
        };

        recog.start();
    }

    function stopListen() {
        if (recog) { try { recog.stop(); } catch(e) {} recog = null; }
        isListening = false;
        _setUI(false);
    }

    function toggleTts() {
        ttsOn = !ttsOn;
        const btn = document.getElementById('vaTtsBtn');
        if (btn) {
            btn.classList.toggle('va-tts-on', ttsOn);
            btn.title = ttsOn ? 'إيقاف الصوت' : 'تشغيل الصوت';
            btn.innerHTML = ttsOn ? '🔊' : '🔇';
        }
        respond(ttsOn ? 'شغلنا الصوت ✅' : 'وقفنا الصوت');
    }

    /* ════════════ UI HELPERS ════════════ */
    function _setUI(listening) {
        const btn = document.getElementById('vaMicBtn');
        if (btn) btn.classList.toggle('va-listening', listening);
        const panel = document.getElementById('vaPanel');
        if (!panel) return;
        if (listening) {
            clearTimeout(panel._hideT);
            panel.classList.add('va-panel-active');
        } else {
            /* أبقِ البانيل ظاهرًا 5 ثوانٍ بعد انتهاء الاستماع ليقرأ المستخدم الرد */
            panel._hideT = setTimeout(() => panel.classList.remove('va-panel-active'), 5000);
        }
    }

    function _setTranscript(t) {
        const el = document.getElementById('vaTranscript');
        if (el) el.textContent = t;
    }

    function _showBrowserWarn() {
        showCard(`
        <div class="va-card-title">المتصفح لا يدعم الميكروفون ⚠️</div>
        <p style="font-size:.82rem;color:var(--t2);margin:.6rem 0">استخدم <b>Google Chrome</b> على الحاسوب أو الهاتف للاستفادة من خاصية الصوت.</p>
        <div style="text-align:center"><button class="va-card-btn va-card-btn-red" onclick="closeCard()">حسناً</button></div>`);
    }

    /* ════════════ HOTKEY ════════════ */
    function _bindHotkey() {
        document.addEventListener('keydown', e => {
            const tag = (document.activeElement || {}).tagName || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.altKey && e.code === 'KeyV') { e.preventDefault(); startListen(); }
        });
    }

    /* ════════════ PUBLIC ════════════ */
    /* ── تصحيح الاسم المنطوق — تُستخدم من app.js ── */
    function matchName(spoken) { return _matchName(spoken); }

    return {
        init, startListen, stopListen, toggleTts,
        pickName, settle, respond, showCard, parse, matchName,
        /* طبقة الذكاء الجديدة */
        checkProactiveAlerts,
        getContext : () => SessionContext,
        weeklyRevenue  : _weeklyRevenue,
        monthlyRevenue : _monthlyRevenue,
        totalDebts     : _totalDebts,
    };

})();
const VA = window.VA; /* توافق مع الاستعمالات المحلية */

/* ── Init on load ── */
document.addEventListener('DOMContentLoaded', () => VA.init());
