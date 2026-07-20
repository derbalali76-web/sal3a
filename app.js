/* ═══════════ STATE ═══════════ */
/* 👆 إغلاق أي نافذة منبثقة بلمس الخلفية خارجها */
if(!window._modalOutsideBound){
    window._modalOutsideBound=true;
    document.addEventListener('DOMContentLoaded',()=>{
        document.querySelectorAll('.modal-overlay').forEach(ov=>{
            ov.addEventListener('pointerdown',(e)=>{
                if(e.target!==ov)return;              /* اللمس داخل النافذة → تجاهل */
                ov._outsideStart=true;
            });
            ov.addEventListener('pointerup',(e)=>{
                if(e.target===ov&&ov._outsideStart)closeModal(ov.id);
                ov._outsideStart=false;
            });
        });
    });
}
/* عند التركيز على حقل داخل نافذة، مرّره للمنتصف كي لا يغطّيه كيبورد الهاتف */
if(!window._focusScrollBound){
    window._focusScrollBound=true;
    document.addEventListener('focusin',(e)=>{
        const t=e.target;
        if(!t||!(t.matches&&t.matches('input,select,textarea')))return;
        const modal=t.closest('.modal,.modal-box'); if(!modal)return;
        setTimeout(()=>{ try{t.scrollIntoView({block:'center',behavior:'smooth'});}catch(_){ } },250);
    });
}

/* 🏷️ اسم العرض: 'دولار' اسم تخزين قديم — يُعرض دائماً «سلعة»
   ('ذهب 730' القديم يُعرض «ذهب 705» لأن الديون وُحّدت على 705) */
window._tDisp=(t)=>t==='دولار'?'سلعة':(t==='ذهب 730'?'ذهب 705':t);
/* 🏷️ أسماء العمليات القديمة كانت تستعمل «دولار» — تُعرض «سلعة» */
window._tName=(t)=>({
    'بيع دولار':'بيع سلعة',
    'شراء دولار':'شراء سلعة',
    'دولار وارد':'سلعة واردة',
    'دولار صادر':'سلعة صادرة',
    'دولار':'سلعة'
}[t]||t||'');

let B={دينار:0,'ذهب 730':0,'ذهب 24':0,دولار:0,vg730:0,vg24:0};
let ops=[],invoices=[],debts=[],loans=[],rafInvoices=[],dollInvoices=[],dubaiInvoices=[],goodsStock=[];
let goldPrice=12500,dollarRate=24800,dollarSellRate=0,dollarBuyRate=0,liveSpotPrice=0;
let g24=[],g730=[];
let invItems=[],currentRafBars=[];
let targetBar=null,targetBarType=null;
let invType='24',gtType='give',darkMode=false;
/* ── نطاق المستخدم الحالي (يُعيَّن بعد تسجيل الدخول) ── */
let _currentUser='',_LSKEY='gp12',_LSDRAFT='gp12_draft',_SITE='';

/* ═══════════ UTILS ═══════════ */
/* ── تنسيق حي للأرقام أثناء الكتابة ── */
function liveNum(el){
    const raw=el.value.replace(/\s/g,'').replace(/,/g,'.');
    if(raw===''||raw==='-'||raw==='.')return;
    const neg=raw.startsWith('-');
    const abs=neg?raw.slice(1):raw;
    const dotIdx=abs.indexOf('.');
    const intPart=dotIdx>=0?abs.slice(0,dotIdx):abs;
    const decPart=dotIdx>=0?abs.slice(dotIdx+1):null;
    const intFmt=intPart.replace(/\B(?=(\d{3})+(?!\d))/g,' ');
    el.value=(neg?'-':'')+intFmt+(decPart!==null?','+decPart:'');
}
/* إدخال بدون فاصلة — آخر رقمين هما الكسر (÷100) */
function liveNum2(el){
    const sel=el.selectionStart;
    const digits=el.value.replace(/[^\d]/g,'');
    if(!digits){el.value='';return;}
    const num=parseInt(digits,10)/100;
    const intPart=Math.floor(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ');
    const decPart=(num%1).toFixed(2).slice(2);
    const prev=el.value;
    el.value=intPart+','+decPart;
    /* حافظ على موضع المؤشر تقريباً */
    const diff=el.value.length-prev.length;
    try{el.setSelectionRange(sel+diff,sel+diff);}catch(e){}
}
function readNum(id){
    const el=document.getElementById(id);
    if(!el)return 0;
    return parseFloat(el.value.replace(/\s/g,'').replace(/,/g,'.').replace(/[−–]/g,'-'))||0;
}
function liveSet(id,val){
    const el=document.getElementById(id);if(!el)return;
    el.value=String(val);liveNum(el);
}
function fmt(n,d=2){
    if(typeof n!=='number')return n;
    const neg=n<0;
    const abs=Math.abs(n);
    const fixed=abs.toFixed(d);
    const [int,dec]=fixed.split('.');
    const intFmt=int.replace(/\B(?=(\d{3})+(?!\d))/g,'\u202F');
    return (neg?'−':'')+intFmt+(d>0?','+dec:'');
}
/* 💵 تنسيق الدينار: يُقرّب لأقرب ألف (آخر 3 خانات = 000) بلا فواصل.
   مثال: 31914893.62 → 31915000 */
function fmtDin(n){
    if(typeof n!=='number'||isNaN(n))return '0';
    const neg=n<0;
    const rounded=Math.round(Math.abs(n)/1000)*1000;
    const intFmt=String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g,'\u202F');
    return (neg?'−':'')+intFmt;
}
window.fmtDin=fmtDin;
/* FIX: uid() غير قابل للاستخدام في onclick بدون quotes — نستخدم base36 نظيف */
function uid(){return '_'+Math.random().toString(36).slice(2,9)+Date.now().toString(36)}


/* ═══════════ VOICE INPUT ═══════════ */
let _voiceActive=false;
window.startVoice=function(target){
    if(!('webkitSpeechRecognition' in window||'SpeechRecognition' in window))
        return toast('⚠️ المتصفح لا يدعم الإدخال الصوتي (جرّب Chrome)','error');
    if(_voiceActive)return;
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    const r=new SR();
    r.lang='ar-DZ';
    r.continuous=false;
    r.interimResults=false;
    const btn=document.getElementById(target==='inv'?'voiceBtnInv':'voiceBtnRaf');
    const origStyle=btn?btn.style.cssText:'';
    function setListening(on){
        _voiceActive=on;
        if(!btn)return;
        if(on){btn.textContent='🔴';btn.style.borderColor='#ef4444';btn.style.color='#ef4444';}
        else{btn.textContent='🎙️';btn.style.cssText=origStyle;}
    }
    r.onstart=()=>{setListening(true);toast('🎙️ استمع... تكلم الآن','info');};
    r.onend=()=>setListening(false);
    r.onerror=()=>{setListening(false);toast('⚠️ لم يتم التعرف على الصوت — حاول مجدداً','error');};
    r.onresult=(e)=>{
        const txt=e.results[0][0].transcript||'';
        _applyVoice(txt,target);
    };
    r.start();
};
/* ═══════════ محرّك الأرقام العربية المنطوقة ═══════════
   يحوّل: الأرقام الهندية (٣٤٥→345)، الكلمات (ثلاثة، خمسمية، تمنطاش)،
   المضاعفات (ألف/مليون/مليار + جموعها ملاير/ملايين/آلاف)، والأرقام المركّبة
   المعطوفة بـ"و" (3 ملاير و650 مليون و400 ألف → 3650400000 بالجمع الصحيح). */
function _arNormTok(t){
    return t.replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ء/g,'');
}
const _AR_ONES={'صفر':0,'واحد':1,'واحده':1,'وحد':1,'وحده':1,'اثنان':2,'اثنين':2,'اثنتين':2,'ثنين':2,'اتنين':2,'زوج':2,'جوج':2,'ثلاثه':3,'ثلاث':3,'تلاته':3,'تلات':3,'تلاث':3,'اربعه':4,'اربع':4,'ربعه':4,'خمسه':5,'خمس':5,'سته':6,'ست':6,'سبعه':7,'سبع':7,'ثمانيه':8,'ثمان':8,'تمنيه':8,'تمن':8,'تسعه':9,'تسع':9};
const _AR_TEENS={'عشره':10,'عشر':10,'احدعشر':11,'حداش':11,'احداش':11,'اثناعشر':12,'طناش':12,'اثناش':12,'تلطاش':13,'ربعطاش':14,'اربعطاش':14,'خمسطاش':15,'ستطاش':16,'سبعطاش':17,'تمنطاش':18,'ثمنطاش':18,'تسعطاش':19};
const _AR_TENS={'عشرين':20,'ثلاثين':30,'تلاتين':30,'اربعين':40,'ربعين':40,'خمسين':50,'ستين':60,'سبعين':70,'ثمانين':80,'تمانين':80,'تسعين':90};
const _AR_HUND={'ميتين':200,'مياتين':200,'ثلاثميه':300,'تلاتميه':300,'اربعميه':400,'ربعميه':400,'خمسميه':500,'ستميه':600,'سبعميه':700,'تمنميه':800,'ثمنميه':800,'تسعميه':900};
const _AR_HUNDRED_WORD=new Set(['ميه','مايه','مئه']); /* تضرب ما قبلها ×100 */
const _AR_FRAC={'نص':0.5,'نصف':0.5,'ربع':0.25,'ثلث':1/3};
const _AR_DUAL={'الفين':2000,'الفان':2000,'مليونين':2000000,'مليارين':2000000000};
const _AR_MULT={'الف':1e3,'الاف':1e3,'اله':1e3,'مليون':1e6,'ملاين':1e6,'ملايين':1e6,'مليار':1e9,'مليارد':1e9,'ملاير':1e9,'ملايير':1e9};
function _arClass(raw){
    if(/^\d+(?:\.\d+)?$/.test(raw)) return {t:'num',v:parseFloat(raw)};
    const w=_arNormTok(raw);
    if(w in _AR_DUAL) return {t:'num',v:_AR_DUAL[w]};
    if(w in _AR_FRAC) return {t:'add',v:_AR_FRAC[w]};
    if(w in _AR_ONES) return {t:'add',v:_AR_ONES[w]};
    if(w in _AR_TEENS) return {t:'add',v:_AR_TEENS[w]};
    if(w in _AR_TENS) return {t:'add',v:_AR_TENS[w]};
    if(_AR_HUNDRED_WORD.has(w)) return {t:'hund'};
    if(w in _AR_HUND) return {t:'add',v:_AR_HUND[w]};
    if(w in _AR_MULT) return {t:'mult',v:_AR_MULT[w]};
    return null;
}
function _arIsNumTok(raw){ return raw!=='و'&&raw!==''&&_arClass(raw)!==null; }
function _arEvalRun(toks){
    let total=0,current=0;
    for(const tok of toks){
        if(tok==='و'||tok==='') continue;
        const c=_arClass(tok); if(!c) continue;
        if(c.t==='num'||c.t==='add'){ current+=c.v; }
        else if(c.t==='hund'){ current=(current||1)*100; }
        else if(c.t==='mult'){ if(current===0)current=1; current*=c.v; total+=current; current=0; }
    }
    return total+current;
}
function _arNumberize(s){
    /* فاصل الآلاف: 600,000 → 600000 و 1,234,567 → 1234567 (لا يمسّ الكسور مثل 3,5) */
    s=s.replace(/[,،](?=\d{3}(?:\D|$))/g,'');
    /* كسور بصيغة عبارة قبل التقطيع */
    s=s.replace(/نص\s*مليار/g,'500000000').replace(/ربع\s*مليار/g,'250000000')
       .replace(/نص\s*مليون/g,'500000').replace(/ربع\s*مليون/g,'250000').replace(/ثلث\s*مليون/g,'333333')
       .replace(/مليار\s*ونص/g,'1500000000').replace(/مليون\s*ونص/g,'1500000').replace(/مليون\s*وربع/g,'1250000');
    /* فصل "و" الملتصقة بعدد أو كلمة-عدد دون لمس "واحد/وحد" */
    const parts=s.split(/\s+/), expanded=[];
    for(const p of parts){
        if(p.length>1&&p[0]==='و'){
            const rest=p.slice(1);
            if(/^\d/.test(rest)||_arIsNumTok(rest)){ expanded.push('و'); expanded.push(rest); continue; }
        }
        expanded.push(p);
    }
    /* اجمع مقاطع الأرقام المتتالية (عدد و عدد ...) في رقم واحد */
    const out=[]; let i=0;
    while(i<expanded.length){
        if(_arIsNumTok(expanded[i])){
            const run=[expanded[i]]; let j=i+1;
            while(j<expanded.length){
                if(_arIsNumTok(expanded[j])){ run.push(expanded[j]); j++; }
                else if(expanded[j]==='و'&&j+1<expanded.length&&_arIsNumTok(expanded[j+1])){ run.push('و'); j++; }
                else break;
            }
            out.push(String(Math.round(_arEvalRun(run)*1000)/1000)); i=j;
        }else{ out.push(expanded[i]); i++; }
    }
    return out.join(' ');
}
function _parseArabicNum(s){
    /* أرقام هندية/فارسية → لاتينية */
    s=(s||'').replace(/[٠-٩]/g,d=>d.charCodeAt(0)-0x0660).replace(/[۰-۹]/g,d=>d.charCodeAt(0)-0x06F0);
    /* فصل الرقم عن الحرف الملتصق: "100غ"→"100 غ" ، "عيار750"→"عيار 750" */
    s=s.replace(/(\d)([\u0621-\u064A])/g,'$1 $2').replace(/([\u0621-\u064A])(\d)/g,'$1 $2');
    return _arNumberize(s).replace(/\s+/g,' ').trim();
}
function _extractVoice(txt){
    const t=_parseArabicNum(txt);
    /* وزن: رقم قبل "غ"/"غرام" أو رقم بعد "ميزان"/"وزن"/"يزن" */
    let wm=t.match(/([\d]+(?:[.,][\d]+)?)\s*(?:غ\b|غرام)/i);
    if(!wm) wm=t.match(/(?:الميزان|ميزان|الوزن|وزن|يزن)\s*([\d]+(?:[.,][\d]+)?)/i);
    /* عيار: رقم بعد "عيار" أو "قيراط" أو "عير" */
    const km=t.match(/(?:عيار|قيراط|عير)\s*([\d]+)/i);
    /* سعر: رقم بعد "سعر" أو "بـ" (يسمح بمسافة) */
    const pm=t.match(/(?:سعر|بـ)\s*([\d]+(?:[.,][\d]+)?)/i);
    /* fallback: أول عددين في النص */
    const nums=(t.match(/[\d]+(?:[.,][\d]+)?/g)||[]).map(n=>parseFloat(n.replace(',','.')));
    const w=wm?parseFloat(wm[1].replace(',','.')):nums[0]||null;
    const k=km?parseInt(km[1]):nums[1]||null;
    const p=pm?parseFloat(pm[1].replace(',','.')):null;
    return{w,k,p,raw:txt};
}
function _applyVoice(txt,target){
    const{w,k,p,raw}=_extractVoice(txt);
    if(!w&&!k)return toast(`⚠️ لم أفهم: "${raw}"  — قل مثلاً: 100 غ عيار 750`,'error');
    if(target==='raf'){
        /* أجد أول سطر فارغ في الرافيناج */
        let placed=false;
        for(let i=1;i<=rafRows;i++){
            const wEl=document.getElementById('rafW_'+i);
            if(wEl&&!wEl.value){
                if(w!=null)wEl.value=w;
                const kEl=document.getElementById('rafK_'+i);
                if(kEl&&k!=null)kEl.value=k;
                calcRaf();
                placed=true;
                toast(`✅ ${w??''}غ عيار ${k??''}`,'info');
                break;
            }
        }
        if(!placed){addRafRow();setTimeout(()=>_applyVoice(txt,target),150);}
    }else{
        /* أجد أول سطر فارغ في الفاتورة */
        let placed=false;
        for(let i=1;i<=invRows;i++){
            const wEl=document.getElementById('inv_w_'+i);
            if(wEl&&!wEl.value){
                if(w!=null)wEl.value=w;
                const kEl=document.getElementById('inv_k_'+i);
                if(kEl&&k!=null)kEl.value=k;
                const pEl=document.getElementById('inv_p_'+i);
                if(pEl&&p!=null)pEl.value=p;
                calcInvRow(i);
                placed=true;
                toast(`✅ ${w??''}غ عيار ${k??''}${p?' سعر '+p:''}`,'info');
                break;
            }
        }
        if(!placed){addInvRow();setTimeout(()=>_applyVoice(txt,target),150);}
    }
}
/* ═══════════ VOICE — HOME ═══════════ */
window.startHomeVoice=function(){
    if(!('webkitSpeechRecognition' in window||'SpeechRecognition' in window))
        return toast('⚠️ المتصفح لا يدعم الإدخال الصوتي (جرّب Chrome)','error');
    if(_voiceActive)return;
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    const r=new SR();
    r.lang='ar-DZ';r.continuous=false;r.interimResults=false;
    const btn=document.getElementById('voiceBtnHome');
    const origText=btn?btn.innerHTML:'';
    function setListening(on){
        _voiceActive=on;
        if(!btn)return;
        if(on){
            btn.innerHTML='<span style="font-size:1.15rem">🔴</span><span>يستمع... تكلم الآن</span>';
            btn.style.borderColor='#ef4444';btn.style.color='#fca5a5';
        }else{
            btn.innerHTML=origText;
            btn.style.borderColor='#8b5cf6';btn.style.color='#c4b5fd';
        }
    }
    r.onstart=()=>setListening(true);
    r.onend=()=>setListening(false);
    r.onerror=()=>{setListening(false);toast('⚠️ لم يتم التعرف على الصوت — حاول مجدداً','error');};
    r.onresult=(e)=>{const txt=e.results[0][0].transcript||'';console.log('🎙️ Chrome قال:',txt);toast(`🎙️ سمع: "${txt}"`,'info');_applyHomeVoice(txt);};
    r.start();
};

/* تحويل الأعداد المكتوبة بكلمات إلى أرقام (عربي + درجة جزائرية) */
function _wordToNum(txt){
    /* نفصل "و" المُلصقة بأرقام أو وحيدة بين كلمات (‌\bو\b لا يعمل مع عربي) */
    const T=_parseArabicNum(txt)
        .replace(/و(\d)/g,' $1')   /* و4  →  4  */
        .replace(/(\d)و/g,'$1 ')   /* 4و  →  4  */
        .replace(/\s+و\s+|\sو$|^و\s/g,' ');
    const W={
        'صفر':0,'واحد':1,'وحدة':1,'اثنين':2,'اثنان':2,'جوج':2,'ثلاثة':3,'ثلاث':3,
        'أربعة':4,'أربع':4,'خمسة':5,'خمس':5,'ستة':6,'ست':6,'سبعة':7,'سبع':7,
        'ثمانية':8,'ثماني':8,'تسعة':9,'تسع':9,
        'عشرة':10,'عشر':10,
        'عشرين':20,'ثلاثين':30,'أربعين':40,'خمسين':50,
        'ستين':60,'سبعين':70,'ثمانين':80,'تسعين':90,
        'مية':100,'مئة':100,'مائة':100,
        'ميتين':200,'مئتين':200,'مئتان':200,'ويتين':200,'مياتين':200,'ميتان':200,
        'ثلاثمية':300,'ثلاثمائة':300,'ثلثمية':300,
        'أربعمية':400,'أربعمائة':400,'ربعمية':400,
        'خمسمية':500,'خمسمائة':500,
        'ستمية':600,'ستمائة':600,
        'سبعمية':700,'سبعمائة':700,
        'ثمانمية':800,'ثمانمائة':800,
        'تسعمية':900,'تسعمائة':900,
        'ألف':1000,'آلاف':1000,'الف':1000,
        /* كيلو = مضاعف ×1000 مثل ألف */
        'كيلو':1000,'كيلوغرام':1000,'كغ':1000,
        'مليون':1000000,'مليار':1000000000
    };
    /* نقرأ التوكنات بالترتيب — كل توكن قد يكون رقماً أو كلمة */
    let total=0,cur=0;
    const tokens=T.split(/\s+/).filter(Boolean);
    for(const w of tokens){
        /* رقم مباشر (Chrome غالباً يعيد الأعداد الكبيرة بالأرقام) */
        const dv=parseFloat(w.replace(',','.'));
        if(!isNaN(dv)&&/^\d/.test(w)){
            /* إن كان cur مُجمَّع (مثل ميتين) نعطيه الرقم المباشر كمضاعف */
            if(cur>0)cur+=dv; else cur=dv;
            continue;
        }
        const v=W[w];
        if(v===undefined)continue;
        if(v===1000){
            /* ألف: تضاعف cur أو تبدأ من 1 */
            cur=cur===0?1000:cur*1000;
        }else if(v>=1000000){
            /* مليون/مليار: cur×مقياس → يُضاف لـtotal */
            if(cur===0)cur=1;
            cur*=v;total+=cur;cur=0;
        }else{
            cur+=v;
        }
    }
    total+=cur;
    return total>0?total:null;
}

/* يصحّح اسم الزبون المنطوق بمقارنته مع دفتر الأسماء في VA */
function _normCust(spoken){
    if(!spoken||!window.VA?.matchName)return spoken;
    const res=VA.matchName(spoken);
    if(res.ok&&res.name!==spoken){
        toast(`🔁 صُحِّح الاسم: "${spoken}" ← "${res.name}"`,'info');
        return res.name;
    }
    return spoken;
}
/* ═══════════ حصيلة الفترة (تقديرية) — اليوم/الشهر ═══════════ */
function _periodSummary(fromTs,toTs){
    const inR=o=>(o._ts||0)>=fromTs&&(o._ts||0)<=toTs;
    let buyG=0,sellGlocal=0,dubaiUSD=0,dubaiDZD=0,expDZD=0,expUSD=0,shipW=0,dubaiCount=0,buyCount=0;
    (ops||[]).forEach(o=>{
        if(!inR(o))return;
        const a=Number(o.a)||0;
        switch(o.t){
            case 'شراء': buyG+=a; buyCount++; break;
            case 'بيع': sellGlocal+=a; break;
            case 'بيع دبي': dubaiUSD+=a; dubaiDZD+=a*(Number(o.rate)||dollarRate||0); dubaiCount++; break;
            case 'شحن': shipW+=a; break;
            case 'مصاريف': if(o.m==='دولار')expUSD+=a; else expDZD+=a; break;
        }
    });
    const expUSDtoDZD=expUSD*(dollarRate||0);
    const net=(dubaiDZD+sellGlocal)-(buyG+expDZD+expUSDtoDZD);
    return {buyG,sellGlocal,dubaiUSD,dubaiDZD,expDZD,expUSD,expUSDtoDZD,shipW,dubaiCount,buyCount,net};
}
function _dayRange(d){const s=new Date(d);s.setHours(0,0,0,0);const e=new Date(d);e.setHours(23,59,59,999);return [s.getTime(),e.getTime()];}
function _monthRange(d){const s=new Date(d.getFullYear(),d.getMonth(),1,0,0,0,0);const e=new Date(d.getFullYear(),d.getMonth()+1,0,23,59,59,999);return [s.getTime(),e.getTime()];}
window.showPeriodSummary=(scope)=>{
    const now=new Date();
    const [from,to]=scope==='month'?_monthRange(now):_dayRange(now);
    const r=_periodSummary(from,to);
    const lbl=scope==='month'?'هذا الشهر':'اليوم';
    const f0=n=>Math.round(n).toLocaleString('fr-FR');
    let m=document.getElementById('periodSumModal');
    if(!m){m=document.createElement('div');m.id='periodSumModal';m.className='modal-overlay';document.body.appendChild(m);}
    m.innerHTML=`<div class="modal-box" style="max-width:430px">
        <div class="modal-header"><h3 style="font-size:.95rem">📊 حصيلة ${lbl}</h3><button class="close-btn" onclick="closeModal('periodSumModal')">✕</button></div>
        <div style="padding:.9rem;font-family:Tajawal,sans-serif;text-align:right;direction:rtl">
          <table style="width:100%;border-collapse:collapse;font-size:.84rem">
            <tr><td style="padding:.35rem 0">🏙️ مبيعات دبي${r.dubaiCount?` (${r.dubaiCount})`:''}</td><td style="text-align:left;font-weight:800">${f0(r.dubaiDZD)} دج <span style="color:var(--t3);font-size:.74rem">(${f0(r.dubaiUSD)} $)</span></td></tr>
            ${r.sellGlocal?`<tr><td style="padding:.35rem 0">🟡 مبيعات محلية</td><td style="text-align:left;font-weight:800">${f0(r.sellGlocal)} دج</td></tr>`:''}
            <tr><td style="padding:.35rem 0">🛒 مشتريات الذهب${r.buyCount?` (${r.buyCount})`:''}</td><td style="text-align:left;font-weight:800;color:#dc2626">− ${f0(r.buyG)} دج</td></tr>
            ${(r.expDZD||r.expUSD)?`<tr><td style="padding:.35rem 0">💸 مصاريف</td><td style="text-align:left;font-weight:800;color:#dc2626">− ${f0(r.expDZD+r.expUSDtoDZD)} دج</td></tr>`:''}
            ${r.shipW?`<tr><td style="padding:.35rem 0;color:var(--t3)">🚢 وزن مشحون</td><td style="text-align:left;color:var(--t3)">${fmt(r.shipW,2)} غ</td></tr>`:''}
            <tr><td colspan="2"><hr style="border:none;border-top:1px solid var(--border);margin:.45rem 0"></td></tr>
            <tr><td style="padding:.35rem 0;font-weight:800">📊 صافي تقديري</td><td style="text-align:left;font-weight:900;font-size:1.05rem;color:${r.net>=0?'#16a34a':'#dc2626'}">${f0(r.net)} دج</td></tr>
          </table>
          <div style="font-size:.66rem;color:var(--t3);margin-top:.7rem;line-height:1.6">⚠️ رقم تقديري يجمع حركات ${lbl} فقط. قد يتأثّر إن اشتريت في فترة وبِعت في أخرى — الشهري أدقّ من اليومي. مبيعات دبي محوّلة بسعر صرف كل فاتورة وقت بيعها.</div>
        </div></div>`;
    m.classList.add('active');
};

function _applyHomeVoice(rawTxt){
    const txt=_parseArabicNum(rawTxt);

    /* ══════════════════════════════════════════════════════
       📊  الفائدة/الحصيلة — يومية أو شهرية
       أمثلة: "الفائدة اليوم" · "حصيلة الشهر" · "كم ربحت اليوم"
    ══════════════════════════════════════════════════════ */
    if(/(فايده|حصيله|ربح|ارباح|مربوح|الربح)/.test(txt.replace(/[إأآٱ]/g,'ا').replace(/[ؤئ]/g,'ي').replace(/ء/g,'').replace(/ى/g,'ي').replace(/ة/g,'ه'))||/مد ?لي الفا/.test(txt)){
        const _nt=txt.replace(/ة/g,'ه');
        const isMonth=/(شهر|شهري)/.test(_nt)||/مد ?لي الفا/.test(txt);
        if(isMonth)showMonthlyProfit(); else showPeriodSummary('day');
        return;
    }

    /* ══════════════════════════════════════════════════════
       🚢  شحن — مثال: "شحن 4004 سعر 3.1 مكتب خليل"
    ══════════════════════════════════════════════════════ */
    if(/^شحن|^ارسل|^أرسل|^بعثت\b|شحنة/.test(txt)){
        /* الوزن: أول رقم في الجملة */
        const allNums=(txt.match(/\d+(?:[.,]\d+)?/g)||[]).map(n=>parseFloat(n.replace(',','.')));
        const weight=allNums[0]||null;
        /* السعر: الرقم بعد كلمة "سعر" */
        let price=0;
        const sM=txt.match(/سعر\s*(\d+(?:[.,]\d+)?)/);
        if(sM)price=parseFloat(sM[1].replace(',','.'));
        /* المكتب: النص بعد "مكتب" أو ما تبقى بعد حذف الكلمات المعروفة */
        let office='';
        const oM=txt.match(/مكتب\s+([\u0600-\u06FF][^\d\n]*?)(?:\s*\d|$)/);
        if(oM)office=oM[1].trim();
        if(!office){
            office=txt.replace(/شحن|ارسل|أرسل|سعر/g,'')
                       .replace(/\d+(?:[.,]\d+)?/g,'')
                       .replace(/\s+/g,' ').trim();
        }
        if(!weight)return toast('⚠️ لم أفهم الوزن — قل: شحن 4000 سعر 3.1 مكتب خليل','error');
        if(!office)return toast('⚠️ لم أفهم اسم المكتب','error');
        openShipping();
        setTimeout(()=>{
            document.getElementById('shipWeight').value=weight;
            document.getElementById('shipPrice').value=price||'';
            document.getElementById('shipOffice').value=office;
            toast(`🚢 شحن ${weight} غ — سعر ${price} — مكتب ${office} | اضغط حفظ للتأكيد`,'info');
        },400);
        return;
    }

    /* ══════════════════════════════════════════════════════
       🛍️  بيع / شراء سلعة (نقبل أيضاً كلمة دولار للتوافق مع العادة)
       مثال بيع : "بيع سلعة خاتم 150000"
       مثال شراء: "شراء سلعة سلسلة 500000"
    ══════════════════════════════════════════════════════ */
    const isBuyDoll =/(?:شراء|اشتريت|اشتري|جبت|جيبي)\s+(?:سلعة|دولار)/.test(txt);
    const isSellDoll=/(?:بيع|بعت|بيعت)\s+(?:سلعة|دولار)/.test(txt);
    if(isBuyDoll||isSellDoll){
        /* السعر: آخر رقم في الجملة */
        const amNums=(txt.match(/\d+(?:[.,]\d+)?/g)||[]).map(n=>parseFloat(n.replace(',','.')));
        const amount=amNums.length?amNums[amNums.length-1]:null;
        /* اسم السلعة: النص العربي بين "سلعة/دولار" وأول رقم */
        let gname='';
        const gPos=txt.search(/سلعة|دولار/);
        if(gPos>-1){
            const afterKw=txt.slice(gPos+5).trim();
            const cM=afterKw.match(/^([\u0600-\u06FF][^\d]*?)(?=\d)/);
            if(cM)gname=cM[1].replace(/سعر|شراء|بيع|من|إلى/g,'').trim();
        }
        if(!gname||!amount)
            return toast('⚠️ قل مثلاً: بيع سلعة خاتم 150000','error');
        openDollar(isBuyDoll?'buy':'sell');
        setTimeout(()=>{
            const row=document.querySelector('#goodsRows .g-row');
            if(row){
                row.querySelector('.g-n').value=gname;
                const pEl=row.querySelector('.g-p'); pEl.value=String(amount); liveNum(pEl);
                _gRowsChanged();
            }
            toast(`🛍️ ${isBuyDoll?'شراء':'بيع'} سلعة — ${gname}: ${fmt(amount,0)} دج | اضغط حفظ للتأكيد`,'info');
        },420);
        return;
    }

    /* ── اتجاه العملية (أخذ / إعطاء) ── */
    const giveRe=/أعطيت|سلّمت|سلمت|دفعت|أدفعت|وزّعت|أخذ|اخذ|خذ|ياخذ|يأخذ|آخذ/;
    const recvRe=/دفع|سلّم|سلم|أعطى|أعطا|أرسل|ارسل|جاب|ودع|أودع/;
    let action=giveRe.test(txt)?'give':recvRe.test(txt)?'receive':null;
    if(!action)action='receive'; /* افتراضي */
    /* ── نوع المعدن ── */
    const typeMap=[
        /* لانقو / لانكو / لانجو / لينجو / لانغو + langou/lango/lanjo (نطق STT) */
        {re:/ل[اي]?ن[قكغجءأ][وى]|لن[قكغجء][وى]|لانق|لانك|لانجو|لينجو|لانغو|langou?|lanjo|lanko|langu|lingot|سبيكة|سبائك|ذهب.?24|عيار.?ألف|عيار.?1000/i,val:'ذهب 24'},
        /* طرونط / سات طرونط / sept trente = كلها تعني ذهب 730 */
        {re:/مكسر|730|ذهب.?730|ذهب.?مكسر|طرونط|ترونط|ترونت|tront|trente|سبعمية.?ثلاثين/i,val:'ذهب 730'},
        {re:/دولار|دلار|\$/,val:'دولار'},
        {re:/دينار|دج|فلوس/,val:'دينار'},
        {re:/ذهب/,val:'ذهب 730'},
    ];
    let metal='دينار';
    for(const{re,val}of typeMap){if(re.test(txt)){metal=val;break;}}
    /* ── المبلغ ── */
    const amount=_wordToNum(txt);
    /* ── اسم الزبون ── */
    /* جملة من نوع: "[اسم] دفع X" أو "دفعت/سلّمت [اسم] X" */
    let customer='';
    const custBefore=txt.match(/^([\u0600-\u06FF ]+?)\s+(?:دفع|سلّم|سلم|أعطى|أعطا|أرسل|جاب|ودع|أخذ|اخذ|خذ|ياخذ|يأخذ)/);
    const custAfter=txt.match(/(?:أعطيت|سلّمت|سلمت|دفعت|أدفعت)\s+([\u0600-\u06FF ]+?)\s+\d/);
    if(custBefore) customer=custBefore[1].trim();
    else if(custAfter) customer=custAfter[1].trim();
    /* تنظيف الكلمات غير الاسمية */
    const stripWords=/\b(دينار|ذهب|دولار|لانقو|لينقو|لانجو|لينجو|لانغو|مكسر|سبيكة|كيلو|فلوس|دج)\b/g;
    customer=customer.replace(stripWords,'').replace(/\s+/g,' ').trim();
    /* fallback: أول كلمة عربية في النص إن لم نجد */
    if(!customer){
        const firstWord=txt.match(/^([\u0600-\u06FF]+)/);
        if(firstWord)customer=firstWord[1];
    }
    /* تصحيح الاسم من دفتر الأسماء */
    customer=_normCust(customer);
    if(!customer||!amount){
        return toast(`⚠️ لم أفهم جيداً: "${rawTxt}" — قل مثلاً: عثمان دفع 5000 دينار`,'error');
    }
    /* ── فتح المودال وملء الحقول ── */
    openGiveTake(action);
    setTimeout(()=>{
        document.getElementById('gtCustomer').value=customer;
        document.getElementById('gtMetal').value=metal;
        liveSet('gtAmount',amount);
        showGTBalance&&showGTBalance();
        window.toggleGTKarat&&window.toggleGTKarat();  /* يضبط التسمية والعرض */
        toast(`✅ ${action==='give'?'تسليم':'استلام'} — ${customer}: ${amount.toLocaleString('ar-DZ')} ${metal}`,'info');
    },420);
}
/* ═══════════ EXPORT / IMPORT — مُعرَّف في firebase.js ═══════════ */
/* exportData و importData مُعرَّفتان في firebase.js وتعملان على متجر الأحداث */
/* ═══════════ DARK MODE ═══════════ */
function applyDark(){
    document.body.classList.toggle('dark',darkMode);
    document.getElementById('darkBtn').innerHTML=darkMode?'<i class="fas fa-sun"></i>':'<i class="fas fa-moon"></i>';
}
function toggleDark(){darkMode=!darkMode;applyDark();save()}
function toggleFullscreen(){
    const btn=document.getElementById('fsBtn');
    if(!document.fullscreenElement){
        document.documentElement.requestFullscreen().catch(()=>{});
        if(btn)btn.innerHTML='<i class="fas fa-compress"></i>';
    }else{
        document.exitFullscreen().catch(()=>{});
        if(btn)btn.innerHTML='<i class="fas fa-expand"></i>';
    }
}
document.addEventListener('fullscreenchange',()=>{
    const btn=document.getElementById('fsBtn');
    if(btn)btn.innerHTML=document.fullscreenElement
        ?'<i class="fas fa-compress"></i>'
        :'<i class="fas fa-expand"></i>';
});

/* ═══════════ SETTINGS ═══════════ */
function openSettings(){
    document.getElementById('settingGoldPrice').value=goldPrice;
    /* لوحة الأدمن */
    const isAdmin=_usersCache[_currentUser]?.isAdmin;
    const ap=document.getElementById('adminPanel');
    if(ap)ap.style.display=isAdmin?'block':'none';
    if(isAdmin)renderUsersList();
    renderGoodsNamesList();
    renderPortalCustList();
    document.getElementById('settingsModal').classList.add('active');
    setTimeout(()=>document.getElementById('settingGoldPrice').focus(),320);
}
function saveSettings(){
    const gp=parseFloat(document.getElementById('settingGoldPrice').value);
    if(!isNaN(gp)&&gp>0)goldPrice=gp;
    closeModal('settingsModal');updAll();save();toast('✅ تم حفظ الإعدادات');
}

/* ═══════════ OPENING BALANCES (مرة واحدة فقط) ═══════════ */
const _LIQ_USED_KEY='gp12_liq_set';
/* ── سلعة الكوفر الافتتاحية بالتفصيل ── */
window._addLiqGoodsRow=(vals)=>{
    const box=document.getElementById('liqGoodsRows');
    if(!box||box.children.length>=30)return;
    const div=document.createElement('div');
    div.className='lg-row';
    div.style.cssText='display:flex;gap:.35rem';
    div.innerHTML=`
        <select class="lg-n" style="flex:1.4;margin:0;min-width:0">${typeof _goodsOptions==='function'?_goodsOptions(vals&&vals.n?String(vals.n):''):'<option value="">🛍️ السلعة…</option>'}</select>
        <input type="text" inputmode="decimal" class="lg-w" placeholder="⚖️ الميزان" dir="ltr" style="flex:1;margin:0;min-width:0;text-align:right">
        <input type="text" inputmode="decimal" class="lg-k" placeholder="🏷️ العيار" dir="ltr" style="flex:.85;margin:0;min-width:0;text-align:right">`;
    div.querySelector('select.lg-n').addEventListener('change',function(){_handleGoodsSelect(this);_liqGoodsChanged();});
    div.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{liveNum(inp);_liqGoodsChanged();}));
    box.appendChild(div);
};
function _liqGoodsChanged(){
    const box=document.getElementById('liqGoodsRows'); if(!box)return;
    const last=box.lastElementChild;
    const gv=(r,c)=>{const el=r.querySelector(c);return el?el.value.trim():'';};
    if(last&&(gv(last,'.lg-n')||gv(last,'.lg-w')||gv(last,'.lg-k')))window._addLiqGoodsRow();
}
window._readLiqGoods=()=>{
    const items=[];
    document.querySelectorAll('#liqGoodsRows .lg-row').forEach(row=>{
        const gv=c=>{const el=row.querySelector(c);return el?el.value.trim():'';};
        const gn=c=>{const el=row.querySelector(c);return el?(parseFloat(el.value.replace(/\s/g,'').replace(/,/g,'.'))||0):0;};
        const n=gv('.lg-n'),w=gn('.lg-w'),k=gn('.lg-k');
        if(n&&w>0&&k>0)items.push({n,w,k,eq:Math.round(w*k/705*1000)/1000});
    });
    return items;
};
let _liqDebtCnt=0;
let _liq730Cnt=0;
window._add730BarRow=(w,k)=>{
    _liq730Cnt++; const i=_liq730Cnt;
    const box=document.getElementById('liq730Bars'); if(!box)return;
    const row=document.createElement('div'); row.id='liq730Row_'+i;
    row.style.cssText='display:flex;gap:.35rem;margin-bottom:.3rem;align-items:center';
    row.innerHTML=`
        <input type="text" inputmode="decimal" id="liq730W_${i}" placeholder="الوزن (غ)" value="${w!=null?w:''}" dir="ltr" oninput="liveNum(this)"
            style="flex:2;padding:.4rem;border-radius:7px;border:1px solid var(--border);background:var(--card2);color:var(--t);font-family:Tajawal,sans-serif;font-size:.74rem;font-weight:800;text-align:right">
        <input type="text" inputmode="numeric" id="liq730K_${i}" placeholder="العيار" value="${k!=null?k:730}" dir="ltr"
            style="flex:1;padding:.4rem;border-radius:7px;border:1px solid var(--border);background:var(--card2);color:var(--t);font-family:Tajawal,sans-serif;font-size:.74rem;font-weight:800;text-align:center">
        <button type="button" onclick="document.getElementById('liq730Row_${i}').remove()"
            style="border:none;background:transparent;color:var(--rd);cursor:pointer;font-size:.9rem;padding:.1rem .3rem">🗑️</button>`;
    box.appendChild(row);
    const wEl=document.getElementById('liq730W_'+i); if(wEl)wEl.focus();
};

window.openLiqEdit=()=>{
    /* السماح بإعادة الإدخال إذا كانت جميع الأرصدة صفراً (استعادة بعد فقدان بيانات) */
    const allZero=B.دينار===0&&B.دولار===0&&g730.length===0&&g24.length===0;
    if(localStorage.getItem(_LIQ_USED_KEY)&&!allZero){
        toast('⚠️ تم اعتماد الأرصدة الافتتاحية مسبقاً — لا يمكن التكرار إلا عند صفر الرصيد','error');
        return;
    }
    /* تصفير الحقول */
    ['liqDinar'].forEach(id=>{
        const el=document.getElementById(id);if(el)el.value='';
    });
    /* أسطر سلعة الكوفر بالتفصيل (إضافة تلقائية) */
    const lg=document.getElementById('liqGoodsRows'); if(lg)lg.innerHTML='';
    window._addLiqGoodsRow();
    /* تصفير جدول الديون وإضافة صف أول */
    _liqDebtCnt=0;
    const tbody=document.getElementById('liqDebtRows');
    if(tbody)tbody.innerHTML='';
    _addLiqDebtRow();
    document.getElementById('liqModal').classList.add('active');
    setTimeout(()=>document.getElementById('liqDinar').focus(),320);
};

window._addLiqDebtRow=()=>{
    _liqDebtCnt++;
    const i=_liqDebtCnt;
    const tbody=document.getElementById('liqDebtRows');
    if(!tbody)return;
    const tr=document.createElement('tr');
    tr.id='liqRow_'+i;
    tr.style.cssText='border-bottom:1px solid var(--brd)';
    tr.innerHTML=`
        <td style="padding:.25rem .3rem">
            <input type="text" id="liqDC_${i}" placeholder="اسم الزبون"
                style="width:100%;min-width:80px;padding:.3rem .4rem;border-radius:6px;border:1px solid var(--border);background:var(--card2);color:var(--t);font-family:Tajawal,sans-serif;font-size:.72rem;font-weight:700">
        </td>
        <td style="padding:.25rem .3rem">
            <input type="text" inputmode="decimal" id="liqDDin_${i}" placeholder="± 0" dir="ltr"
                style="width:100%;min-width:70px;padding:.3rem .4rem;border-radius:6px;border:1px solid var(--border);background:var(--card2);color:var(--t);font-family:Tajawal,sans-serif;font-size:.72rem;font-weight:700;text-align:right"
                oninput="liveNum(this)">
        </td>
        <td style="padding:.25rem .3rem">
            <input type="text" inputmode="decimal" id="liqDGd_${i}" placeholder="± 0 غ" dir="ltr"
                style="width:100%;min-width:70px;padding:.3rem .4rem;border-radius:6px;border:1px solid var(--border);background:var(--card2);color:var(--t);font-family:Tajawal,sans-serif;font-size:.72rem;font-weight:700;text-align:right"
                oninput="liveNum(this)">
        </td>
        <td style="padding:.25rem;text-align:center">
            <button onclick="document.getElementById('liqRow_${i}').remove()"
                style="border:none;background:transparent;color:var(--rd);cursor:pointer;font-size:.85rem">🗑️</button>
        </td>`;
    tbody.appendChild(tr);
}

window.confirmLiqEdit=()=>{
    const allZero=B.دينار===0&&B.دولار===0&&g730.length===0&&g24.length===0;
    if(localStorage.getItem(_LIQ_USED_KEY)&&!allZero){
        toast('⚠️ تم اعتماد الأرصدة مسبقاً','error');return;
    }
    const dinar  = readNum('liqDinar');
    /* 🛍️ سلعة الكوفر بالتفصيل (اسم + ميزان + عيار) — تدخل المخزون */
    const goodsItems=_readLiqGoods();
    const dollar = Math.round(goodsItems.reduce((s,it)=>s+it.eq,0)*1000)/1000; /* مكافئ 705 إجمالي */
    const bars730=[],g730raw=0,g730v=0;

    /* ديون الزبائن: دينار ± وسلعة (705) ± موقّعة مباشرة */
    const debtRows=[];
    document.querySelectorAll('#liqDebtRows tr[id^="liqRow_"]').forEach(tr=>{
        const i=tr.id.replace('liqRow_','');
        const c=(document.getElementById('liqDC_'+i)?.value||'').trim();
        if(!c)return;
        const din=readNum('liqDDin_'+i);
        const gd =readNum('liqDGd_'+i);
        if(din)debtRows.push({c,type:'دينار',amt:din,dir:'لنا'});   /* الإشارة في القيمة نفسها */
        if(gd) debtRows.push({c,type:'دولار',amt:gd, dir:'لنا'});
    });

    const sumLines=[];
    if(dinar !==0&&!isNaN(dinar)&&dinar) sumLines.push(`💵 دينار: ${fmt(dinar,0)} دج`);
    if(goodsItems.length){
        sumLines.push(`🛍️ سلعة الكوفر (${goodsItems.length}):`);
        goodsItems.forEach(it=>sumLines.push(`  • ${it.n}: ${fmt(it.w,2)} غ عيار ${fmt(it.k,0)} → ${fmt(it.eq,2)} غ (705)`));
        sumLines.push(`  = المجموع بالمكافئ: ${fmt(dollar,2)} غ (705)`);
    }
    if(debtRows.length){
        sumLines.push('');sumLines.push('ديون الزبائن:');
        debtRows.forEach(r=>sumLines.push(
            `  ${r.amt>=0?'🟢':'🔴'} ${r.c}: ${fmt(r.amt,2)} ${r.type==='دولار'?'غ سلعة (705)':'دج'}`
        ));
    }
    if(!sumLines.length) return toast('أدخل رصيداً أو ديناً واحداً على الأقل','error');
    if(!confirm(`سيتم اعتماد الأرصدة الافتتاحية التالية:\n\n${sumLines.join('\n')}\n\nهذه العملية لا يمكن تكرارها. هل أنت متأكد؟`))return;

    const dt=new Date().toLocaleDateString('fr-FR');
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    const barsAdd=[];
    const dispBars={};
    bars730.forEach(b=>{
        const bid=uid();
        barsAdd.push({id:bid,pool:'730',w:b.w,k:b.k});
        dispBars[bid]={desc:'رصيد افتتاحي',dt,src:'افتتاحي'};
    });
    emitEvent('OPENING',
        {dinar,dollar,g730v,debtRows,barsAdd,goodsItems,goldPrice},
        {
            bars:Object.keys(dispBars).length?dispBars:undefined,
            op:{c:'النظام',t:'رصيد افتتاحي',m:'متعدد',a:dinar||dollar||g730v,
                _ts:Date.now(),dt:nowStr}
        }
    );

    try{localStorage.setItem(_LIQ_USED_KEY,'1');}catch(e){}
    ['liqEditBtn','liqSettingsBtn'].forEach(id=>{
        const el=document.getElementById(id);if(el)el.style.display='none';
    });
    closeModal('liqModal');
    toast(`✅ تم اعتماد الأرصدة الافتتاحية${debtRows.length?' مع '+debtRows.length+' دين':''}`);
};

/* ═══════════ BALANCE ═══════════ */
function syncBal(){
    B['ذهب 24'] =g24.reduce((s,b)=>s+(b.w||0),0);
    /* المخزون 730 = مجموع (وزن × عيار ÷ 730) لكل قطعة */
    B['ذهب 730']=g730.reduce((s,b)=>s+(b.w||0)*((b.k||730)/730),0);
}
function _netBuckets(){
    const d_din =debts.reduce((s,d)=>d.type==='دينار'  ?s+(d.a||0):s,0);
    const d_dol =debts.reduce((s,d)=>d.type==='دولار'  ?s+(d.a||0):s,0);  /* ديون السلعة (غ 705) */
    const d_730 =debts.reduce((s,d)=>d.type==='ذهب 730'?s+(d.a||0):s,0);  /* بمكافئ 730 */
    const d_24  =debts.reduce((s,d)=>d.type==='ذهب 24' ?s+(d.a||0):s,0);  /* بالغرام الخام 24 */

    /* ═══ كل الذهب موحَّد بمكافئ 705 ثم × سعر الذهب ═══
       المكوّنات (كلها بمكافئ 705):
       • السلعة (B.دولار مخزَّنة بالفعل بمكافئ 705)
       • مخزون 705 (B['ذهب 730'] مخزَّن بمكافئ 730 → ×730/705)
       • مخزون 24 (خام 24 → ×1000/705)
       • صافي ديون السلعة (d_dol بمكافئ 705)
       • صافي ديون 24 (خام 24 → ×1000/705)
    */
    const inv705    = B.دولار;                                   /* السلعة */
    const stock705  = (B['ذهب 730']+(B.vg730||0)) * (730/705);   /* مخزون 705 */
    /* مخزون 24 كمكافئ 705 — بعيار كل سبيكة (لا افتراض 1000 للجميع) */
    const stock24_705 = (typeof g24!=='undefined'?g24:[]).reduce((s,b)=>s+(b.w||0)*((b.k||1000)/705),0)
                      + (B.vg24||0)*(1000/705);
    const debtGoods705 = d_dol;                                  /* صافي ديون السلعة */
    const debt24_705   = d_24 * (1000/705);                      /* صافي ديون 24 كمكافئ 705 */
    /* ديون 705/730 القديمة (إن وُجدت) بمكافئ 705 */
    const debt730_705  = d_730 * (730/705);

    const gold705Total = inv705 + stock705 + stock24_705 + debtGoods705 + debt24_705 + debt730_705;
    const goldValue    = gold705Total * goldPrice;               /* × سعر الذهب */

    /* السيولة + صافي ديون الدينار */
    const cashValue    = B.دينار + d_din;

    /* توافق مع العرض القديم للتفاصيل */
    const raw_din  = B.دينار      + d_din;
    const raw_dol  = inv705       + debtGoods705;
    const raw_730  = (B['ذهب 730']+(B.vg730||0)) + d_730;
    const raw_24   = (B['ذهب 24'] +(B.vg24||0))  + d_24;
    return{
        din:cashValue, dol:raw_dol*goldPrice*(1), g730:stock705*goldPrice, g24:stock24_705*goldPrice,
        raw_din, raw_dol, raw_730, raw_24,
        goldValue, cashValue, gold705Total
    };
}
function net(){
    const b=_netBuckets();
    return b.goldValue + b.cashValue;
}
function getCustBal(c,metal){return debts.filter(d=>d.c===c&&d.type===metal).reduce((s,d)=>s+(d.a||0),0)}

/* ═══════════ UI ═══════════ */
function upd(){
    document.getElementById('dinarBal').innerHTML=fmtDin(B.دينار)+'<small> DZD</small>';
    /* بطاقة 705: القيمة الداخلية مكافئ 730 — نعرضها مكافئ 705 (×730÷705) */
    document.getElementById('g730Bal').innerHTML=fmt((B['ذهب 730']+(B.vg730||0))*(730/705),2)+'<small> غ (705)</small>';
    document.getElementById('g24Bal').innerHTML=fmt(B['ذهب 24']+(B.vg24||0),2)+'<small> g</small>';
    document.getElementById('usdBal').innerHTML=fmt(B.دولار,2)+'<small> غ</small>';
    const _bk=_netBuckets();
    /* ═══ ذهب البيع (الكاصي): لاكاص يجب شراؤه/بيعه من صافي حركة الكاصي ═══ */
    const _gsc=document.getElementById('goldSaleContent');
    if(_gsc){
        const tr=window._cashiTracker||{buyW:0,buyDin:0,soldW:0,soldDin:0};
        /* صافي اللاكاص المطلوب = ما قبضته كاصي بالدينار − ما اشتريته فعلاً (أجرة بالكاصي) */
        const netW=Math.round((tr.buyW-tr.soldW)*1000)/1000;
        const netDin=Math.round(tr.buyDin-tr.soldDin);
        const _rows=[];
        if(Math.abs(netW)<0.001){
            _rows.push(`<div style="text-align:center;color:var(--t3);font-size:.78rem;padding:.3rem">لا يوجد كاصي معلّق</div>`);
        } else if(netW>0){
            /* لاكاص يجب شراؤه: قبضت أكثر مما اشتريت */
            const price=netW>0?Math.round(netDin/netW):0;
            _rows.push(`<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.35);border-radius:10px;padding:.5rem .7rem">
                <span style="font-weight:900;color:#059669">🛒 لاكاص تشتريه</span>
                <span style="font-weight:900;color:#059669" dir="ltr">${fmt(netW,2)} غ</span>
            </div>`);
            _rows.push(`<div style="text-align:left;font-size:.68rem;color:var(--t2);padding:0 .3rem" dir="ltr">السعر: ${fmt(price,0)} دج/غ · إجمالي ${fmt(netDin,0)} دج</div>`);
        } else {
            /* لاكاص كثير تبيعه: اشتريت أكثر مما قبضت */
            const sellW=Math.abs(netW), sellDin=Math.abs(netDin);
            const price=sellW>0?Math.round(sellDin/sellW):0;
            _rows.push(`<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.35);border-radius:10px;padding:.5rem .7rem">
                <span style="font-weight:900;color:#dc2626">🏷️ لاكاص تبيعه</span>
                <span style="font-weight:900;color:#dc2626" dir="ltr">${fmt(sellW,2)} غ</span>
            </div>`);
            _rows.push(`<div style="text-align:left;font-size:.68rem;color:var(--t2);padding:0 .3rem" dir="ltr">سعر البيع: ${fmt(price,0)} دج/غ · إجمالي ${fmt(sellDin,0)} دج</div>`);
        }
        _gsc.innerHTML=_rows.join('');
    }
    const _nv=net();
    const _nwEl=document.getElementById('netWorth');
    _nwEl.textContent=fmtDin(_nv)+' DZD';
    _nwEl.style.color=_nv<0?'var(--rd)':'var(--g400)';
    /* تفاصيل كل وعاء بالدينار */
    const _parts=[];
    _parts.push(`🥇 الذهب (705): ${fmt(_bk.gold705Total,2)} غ = ${fmtDin(_bk.goldValue)} دج`);
    _parts.push(`💵 السيولة+الديون: ${fmtDin(_bk.cashValue)} دج`);
    document.getElementById('netWorthDetails').textContent=_parts.join(' | ');
    document.getElementById('goldPriceDisplay').textContent=fmt(goldPrice,0);
}
function addOp(c,t,m,a,ex={}){
    /* no-op — الكتابة تتم عبر emitEvent() فقط */
}
function updDebt(c,m,a){
    const x=debts.find(d=>d.c===c&&d.type===m);
    if(x){x.a+=a;if(Math.abs(x.a)<0.001)debts=debts.filter(d=>d!==x)}
    else if(Math.abs(a)>0.001)debts.push({c,type:m,a});
}
function updAll(){
    upd(); updDL();                 /* لوحة الأرقام وقائمة الأسماء — خفيفة ودائماً مفيدة */
    const act=(document.querySelector('.page.active')||{}).id||'';
    if(act==='page-log') renderLog();
    else if(act==='page-archive') renderArchive();
    else if(act==='page-debts') renderDebts();
    else if(act==='page-profit') renderProfit();
    /* الصفحات غير النشطة تُرسَم عند التبديل إليها عبر switchPage — فلا داعي لرسمها هنا */
}
function updDL(){
    const names=[...new Set([...debts.map(d=>d.c),...loans.map(l=>l.c)])].filter(Boolean);
    document.getElementById('customersDatalist').innerHTML=names.map(n=>`<option value="${n}">`).join('');
}
function toast(m,t='success'){
    const el=document.getElementById('toast');
    const icon=t==='success'?'check-circle':t==='error'?'exclamation-circle':'info-circle';
    el.innerHTML=`<i class="fas fa-${icon}"></i> ${m}`;
    el.className=`toast ${t} show`;
    clearTimeout(el._t);
    el._t=setTimeout(()=>el.classList.remove('show'),2800);
}
function closeModal(id){
    const er=window._editRestore;
    if(er&&er.modalId===id){ window._editRestore=null; if(typeof _reemitSnapshot==='function')_reemitSnapshot(er.snap); toast('↩️ أُلغي التعديل واستُعيدت الفاتورة','info'); }
    document.getElementById(id).classList.remove('active');
}
/* window.resetAllData مُعرَّفة في firebase.js */


/* ═══════════ GIVE / TAKE ═══════════ */
window.toggleGTKarat=()=>{
    const m=document.getElementById('gtMetal').value;
    const l=document.getElementById('gtAmountLabel');
    const eq=document.getElementById('gtEqBox');
    const kr=document.getElementById('gtKaratRow');
    const ex=document.getElementById('gt730Extra');
    if(m==='ذهب 730'){
        l.textContent='الوزن (غ)';
        if(kr)kr.style.display='';
        eq.style.display='block';
        /* قائمة سبائك إضافية تظهر فقط عند الاستلام (قبضت) */
        if(ex)ex.style.display=(gtType==='take')?'block':'none';
        calcGTEq();
    }else{
        l.textContent='الكمية / المبلغ';
        if(kr)kr.style.display='none';
        eq.style.display='none';
        if(ex)ex.style.display='none';
    }
};
let _gt730Cnt=0;
window._addGT730Bar=(w,k)=>{
    _gt730Cnt++; const i=_gt730Cnt;
    const box=document.getElementById('gt730Bars'); if(!box)return;
    const row=document.createElement('div'); row.id='gt730Row_'+i;
    row.style.cssText='display:flex;gap:.35rem;margin-bottom:.3rem;align-items:center';
    row.innerHTML=`
        <input type="text" inputmode="decimal" id="gt730W_${i}" placeholder="وزن إضافي (غ)" value="${w!=null?w:''}" dir="ltr" oninput="liveNum(this);window.calcGTEq()"
            style="flex:2;padding:.4rem;border-radius:7px;border:1px solid var(--border);background:var(--card2);color:var(--t);font-family:Tajawal,sans-serif;font-size:.74rem;font-weight:800;text-align:right">
        <input type="text" inputmode="numeric" id="gt730K_${i}" placeholder="العيار" value="${k!=null?k:730}" dir="ltr" oninput="window.calcGTEq()"
            style="flex:1;padding:.4rem;border-radius:7px;border:1px solid var(--border);background:var(--card2);color:var(--t);font-family:Tajawal,sans-serif;font-size:.74rem;font-weight:800;text-align:center">
        <button type="button" onclick="document.getElementById('gt730Row_${i}').remove();window.calcGTEq()"
            style="border:none;background:transparent;color:var(--rd);cursor:pointer;font-size:.9rem;padding:.1rem .3rem">🗑️</button>`;
    box.appendChild(row);
    const wEl=document.getElementById('gt730W_'+i); if(wEl)wEl.focus();
};
/* يجمع كل سبائك 730 المُدخَلة: الحقل الرئيسي + الصفوف الإضافية */
function _collectGT730Bars(){
    const bars=[];
    const aw=readNum('gtAmount');
    const ak=parseFloat(document.getElementById('gtKarat')?.value)||730;
    if(aw>0)bars.push({w:aw,k:ak});
    document.querySelectorAll('#gt730Bars [id^="gt730Row_"]').forEach(row=>{
        const i=row.id.replace('gt730Row_','');
        const w=readNum('gt730W_'+i);
        const k=parseFloat(String(document.getElementById('gt730K_'+i)?.value||'730').replace(',','.'))||730;
        if(w>0)bars.push({w,k});
    });
    return bars;
}
window.calcGTEq=()=>{
    if(document.getElementById('gtMetal').value!=='ذهب 730')return;
    /* عند الاستلام: اجمع كل السبائك (الرئيسي + الإضافية) */
    if(gtType==='take'){
        const bars=_collectGT730Bars();
        if(bars.length>1){
            const tw=bars.reduce((s,b)=>s+b.w,0);
            const pure=bars.reduce((s,b)=>s+b.w*b.k/1000,0);
            const eq730=bars.reduce((s,b)=>s+b.w*b.k/730,0);
            document.getElementById('gtEqBox').innerHTML=
                `${bars.length} سبيكة | الوزن الكلي: <strong>${fmt(tw,2)} غ</strong> | خالص م.24: <strong>${fmt(pure,3)} غ</strong> | مكافئ 730: <strong>${fmt(eq730,3)} غ</strong>`;
            return;
        }
    }
    const w=readNum('gtAmount');
    const k=parseFloat(document.getElementById('gtKarat')?.value)||730;
    const pure=w*k/1000;
    document.getElementById('gtEqBox').innerHTML=
        `الوزن: <strong>${fmt(w,2)} غ</strong> | عيار: <strong>${k}</strong> | خالص م.24: <strong>${fmt(pure,3)} غ</strong>`;
};
document.getElementById('gtAmount').addEventListener('input',window.calcGTEq);
window.showGTBalance=()=>{
    const c=document.getElementById('gtCustomer').value.trim();
    const m=document.getElementById('gtMetal').value;
    const box=document.getElementById('gtBalBox');
    if(!c){box.style.display='none';return}
    const b=getCustBal(c,m),unit=m==='دينار'?'دج':'غ';
    box.innerHTML=`👤 رصيد ${_tDisp(m)}: <strong style="color:${b>=0?'var(--gr)':'var(--rd)'}">${fmt(b,2)} ${unit}</strong>`;
    box.style.display='block';
};
window.openGiveTake=(t)=>{
    gtType=(t==='give')?'give':'take';
    document.getElementById('gtTitle').textContent=(t==='give'?'🟢 تسليم (أعطيت)':'🔴 استلام (قبضت)')+'';
    document.getElementById('gtSaveBtn').className=t==='give'?'bg':'br';
    document.getElementById('gtCustomer').value='';
    document.getElementById('gtAmount').value='';
    document.getElementById('gtMetal').value='دينار';
    document.getElementById('gtNote').value='';
    const kEl=document.getElementById('gtKarat');if(kEl)kEl.value='730';
    /* تصفير قائمة سبائك 730 الإضافية */
    _gt730Cnt=0; const gb=document.getElementById('gt730Bars'); if(gb)gb.innerHTML='';
    window.toggleGTKarat();
    document.getElementById('gtBalBox').style.display='none';
    document.getElementById('gtModal').classList.add('active');
    setTimeout(()=>document.getElementById('gtCustomer').focus(),350);
};
window.saveGT=()=>{
    const c=document.getElementById('gtCustomer').value.trim();
    const m=document.getElementById('gtMetal').value;
    const a=readNum('gtAmount');
    const k=m==='ذهب 730'?(parseFloat(document.getElementById('gtKarat')?.value)||730):730;
    const isG730=m==='ذهب 730',isG24=m==='ذهب 24';
    /* استلام ذهب 730: قد يكون عدّة سبائك */
    let gt730Bars=null;
    if(isG730&&gtType==='take'){
        gt730Bars=_collectGT730Bars();
        if(!c||!gt730Bars.length)return toast('أدخل الاسم ووزن سبيكة واحدة على الأقل','error');
    }else{
        if(!c||isNaN(a)||a<=0)return toast('تأكد من البيانات','error');
    }
    const totW = gt730Bars?gt730Bars.reduce((s,b)=>s+b.w,0):a;
    const uniformK = gt730Bars?(gt730Bars.every(b=>b.k===gt730Bars[0].k)?gt730Bars[0].k:0):k;
    const finalAmount = gt730Bars
        ? gt730Bars.reduce((s,b)=>s+b.w*b.k/730,0)
        : (isG730?(a*k)/730:a);
    const note=document.getElementById('gtNote').value.trim();
    const dt=new Date().toLocaleDateString('fr-FR');
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});

    let barsAdd=[],barsRemove=[],barUpdates=[];
    if(gtType==='give'){
        if((B[m]||0)<finalAmount-0.001)return toast('⚠️ رصيد غير كافٍ','error');
        if(isG730||isG24){
            const r=_pickBarsToRemove(isG730?'730':'24',a);
            barsRemove=r.barsRemove;barUpdates=r.barUpdates;
        }
    }else{
        if(isG730){ gt730Bars.forEach(b=>{ barsAdd.push({id:uid(),pool:'730',w:b.w,k:b.k}); }); }
        else if(isG24){const bid=uid();barsAdd.push({id:bid,pool:'24',w:a,k:1000});}
    }
    const dispBars={};
    barsAdd.forEach(b=>{
        dispBars[b.id]={
            desc:gtType==='take'?`استلام من ${c} (عيار ${b.k})`:`تسليم لـ ${c}`,
            dt,src:gtType==='take'?'استلام':'تسليم'
        };
    });
    emitEvent('GT',
        {gtType,c,m,finalAmount,realW:isG730?totW:undefined,realK:isG730?(uniformK||730):undefined,note,barsAdd,barsRemove,barUpdates},
        {
            bars:Object.keys(dispBars).length?dispBars:undefined,
            op:{c,t:gtType==='give'?'أعطيت':'استلمت',m,a:finalAmount,
                _ts:Date.now(),dt:nowStr,
                ...(isG730?{realW:totW,realK:(uniformK||'متعدد'),note,bars730:gt730Bars||undefined}:{note})}
        }
    );
    document.getElementById('gtCustomer').value='';
    document.getElementById('gtAmount').value='';
    document.getElementById('gtNote').value='';
    const gb=document.getElementById('gt730Bars'); if(gb)gb.innerHTML=''; _gt730Cnt=0;
    document.getElementById('gtBalBox').style.display='none';
    closeModal('gtModal');
    toast(gt730Bars&&gt730Bars.length>1?`✅ تم استلام ${gt730Bars.length} سبيكة`:'✅ تم الحفظ بنجاح');
};

/* ═══════════ سلعة (كانت DOLLAR — نحافظ على نوع الحدث للتوافق) ═══════════ */
/* ═══════════ 📱 بوابة الزبائن — كشف الحساب برقم الهاتف ═══════════ */
window._portalCust=window._portalCust||{}; /* {phone: customerName} */
(function(){ try{ const v=JSON.parse(localStorage.getItem('gp12_portalCust')||'{}'); if(v&&typeof v==='object')window._portalCust=v; }catch(e){} })();
function _persistPortalCust(){
    try{localStorage.setItem('gp12_portalCust',JSON.stringify(window._portalCust));}catch(e){}
    if(window._savePortalCustFb)try{window._savePortalCustFb(window._portalCust);}catch(e){}
    renderPortalCustList();
    if(window._publishPortalDebounced)window._publishPortalDebounced();
}
window._normPhone=(p)=>String(p||'').replace(/[^0-9]/g,'');
/* 🏪 هوية المحل في مسار البوابة = اسم المستخدم (يطابق بريد المصادقة فتفرضه القواعد) */
/* هوية المحل = اسم المستخدم (مطابق لبريد المصادقة فتفرضه قاعدة البوابة).
   الأسماء فريدة عالمياً فلا تصادم بين محلّين. */
window._shopId=()=>String(_currentUser||'').toLowerCase().replace(/[.$#\[\]\/\s]/g,'_');
window.addPortalCust=()=>{
    const n=(document.getElementById('portalCustName')?.value||'').trim();
    const ph=window._normPhone(document.getElementById('portalCustPhone')?.value);
    const pin=(document.getElementById('portalCustPin')?.value||'').trim().replace(/[\/\.\#\$\[\]\s]/g,'');
    if(!n||!ph||ph.length<8)return toast('أدخل اسم الزبون ورقم هاتف صحيح','error');
    if(!pin||pin.length<4)return toast('اختر كلمة سر للزبون (4 خانات على الأقل)','error');
    window._portalCust[ph]={n,pin};
    document.getElementById('portalCustName').value='';
    document.getElementById('portalCustPhone').value='';
    document.getElementById('portalCustPin').value='';
    _persistPortalCust();
    toast(`✅ ${n} — يدخل بالرقم ${ph} وكلمة السر ${pin}`);
};
window.delPortalCust=(ph)=>{
    const _e=window._portalCust[ph];
    if(!confirm(`إلغاء وصول ${_e&&_e.n?_e.n:_e} (${ph})؟`))return;
    const _pin=_e&&_e.pin?_e.pin:null;
    delete window._portalCust[ph];
    /* نحذف عقدة محلّنا فقط — لا نمسّ كشوف المحلات الأخرى لنفس الرقم */
    if(_pin&&window._delPortalNodeFb)try{window._delPortalNodeFb(ph,_pin,window._shopId());}catch(e){}
    _persistPortalCust();
};
window.renderPortalCustList=()=>{
    const el=document.getElementById('portalCustList'); if(!el)return;
    const keys=Object.keys(window._portalCust);
    el.innerHTML=keys.length?keys.map(ph=>{
        const e=window._portalCust[ph];
        const nm=e&&e.n?e.n:String(e||'');
        const pin=e&&e.pin?e.pin:'—';
        return `
        <div style="display:flex;align-items:center;gap:.4rem;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:.3rem .5rem;font-size:.72rem;font-weight:800">
            <span style="flex:1">👤 ${nm}</span>
            <span dir="ltr" style="color:var(--t2)">${ph}</span>
            <span dir="ltr" style="color:var(--g500)">🔑 ${pin}</span>
            <b onclick="delPortalCust('${ph}')" style="cursor:pointer;color:var(--rd)">✕</b>
        </div>`;}).join(''):'<small style="color:var(--t3)">لا يوجد زبائن مرتبطون بعد</small>';
};
/* ── الناشر: يدفع كشف كل زبون مرتبط إلى عقدة goldpro/portal/{هاتف} ── */
window._publishPortal=()=>{
    if(!window._savePortalDataFb)return;
    const phones=Object.keys(window._portalCust||{});
    if(!phones.length)return;
    phones.forEach(ph=>{
        const _e=window._portalCust[ph];
        const name=_e&&_e.n?_e.n:String(_e||'');
        const pin=_e&&_e.pin?_e.pin:null;
        if(!name||!pin)return; /* الصيغة القديمة بلا كلمة سر لا تُنشر */
        const myOps=(ops||[]).filter(o=>o.c===name).slice(0,200).map(o=>({
            id:o.id||'',t:o.t||'',a:o.a||0,m:o.m||'',dt:o.dt||'',did:o.did||'',fee:o.fee||0
        }));
        const inv={};
        (dollInvoices||[]).filter(v=>v.c===name).slice(0,100).forEach(v=>{inv[v.id]=v;});
        const payload={
            name, shop:(window._snName||_currentUser||''), upd:Date.now(),  /* اسم المحل الودّي من السريال */
            din:Math.round(getCustBal(name,'دينار')*100)/100,
            gold:Math.round(getCustBal(name,'دولار')*1000)/1000,
            ops:myOps, inv
        };
        try{window._savePortalDataFb(ph,pin,window._shopId(),payload);}catch(e){}
    });
};
window._publishPortalDebounced=(function(){let t=null;return function(){clearTimeout(t);t=setTimeout(()=>{try{window._publishPortal();}catch(e){}},2500);};})();

/* ── جهة الزبون ── */
/* 👤 بوابة الزبون من شاشة التفعيل — بلا رمز تفعيل */
window.openCustGate=()=>{
    const g=document.getElementById('custGate'); if(g)g.style.display='flex';
    const e=document.getElementById('cgErr'); if(e)e.style.display='none';
    setTimeout(()=>{const p=document.getElementById('cgPhone');if(p)p.focus();},250);
};
window.closeCustGate=()=>{ const g=document.getElementById('custGate'); if(g)g.style.display='none'; };
window.custGateGo=async()=>{
    const ph=(document.getElementById('cgPhone')?.value||'').trim();
    const pin=(document.getElementById('cgPin')?.value||'').trim();
    const err=document.getElementById('cgErr');
    const show=(m)=>{if(err){err.textContent=m;err.style.display='block';}};
    if(!ph)return show('أدخل رقم هاتفك');
    if(!pin)return show('أدخل كلمة السر');
    show('⏳ جارٍ البحث…');
    const ok=await window._tryCustomerPortal(ph,pin);
    if(ok){
        closeCustGate();
        const so=document.getElementById('serialOverlay'); if(so)so.style.display='none';
    }else{
        show('الرقم أو كلمة السر غير صحيحة — راجع المحل');
    }
};
window.closeCustPortal=()=>{
    const pk=document.getElementById('portalShopPicker'); if(pk)pk.remove();
    const sc=document.getElementById('custPortalScreen'); if(sc)sc.style.display='none';
    if(window._portalRef){try{window._portalRef.off();}catch(e){} window._portalRef=null;}
    window._portalMode=false;
    /* غير مفعَّل على هذا الجهاز → ارجع لشاشة التفعيل (الزبون ليس معه رمز) */
    if(!localStorage.getItem('gp12_sn')){
        const so=document.getElementById('serialOverlay');
        if(so){so.style.display='flex';return;}
    }
    const ov=document.getElementById('loginOverlay');
    if(ov){ov.style.display='';ov.classList.remove('fade-out');}
    const pu=document.getElementById('loginUser'),pp=document.getElementById('loginPw');
    if(pu)pu.value='';if(pp)pp.value='';
};
/* 👤 محاولة دخول الزبون من نافذة الدخول الموحّدة — تُرجع true عند النجاح */
window._tryCustomerPortal=async(phoneDigits,pin)=>{
    const ph=window._normPhone(phoneDigits);
    const cleanPin=(pin||'').trim().replace(/[\/\.\#\$\[\]\s]/g,'');
    if(!ph||ph.length<8||!cleanPin)return false;
    try{
        window._portalMode=true;
        if(!firebase.auth().currentUser)await firebase.auth().signInAnonymously();
        const base=firebase.database().ref('goldpro/portal/'+ph+'/'+cleanPin);
        const snap=await base.once('value');
        const d=snap.val();
        if(!d){ window._portalMode=false; return false; }

        /* 🏪 قد يكون الزبون مرتبطاً بأكثر من محل بنفس الرقم وكلمة السر */
        let shops=[];
        if(d.name){                       /* صيغة قديمة: كشف واحد مباشرةً */
            shops=[{key:null,data:d}];
        }else{
            shops=Object.keys(d).filter(k=>d[k]&&d[k].name).map(k=>({key:k,data:d[k]}));
        }
        if(!shops.length){ window._portalMode=false; return false; }

        const _open=(entry)=>{
            const ref=entry.key?base.child(entry.key):base;
            if(window._portalRef){try{window._portalRef.off();}catch(_){}}
            window._portalRef=ref;
            ref.on('value',s2=>{const v=s2.val();if(v&&v.name)window._renderCustPortal(v);});
            window._renderCustPortal(entry.data);
            const ov=document.getElementById('loginOverlay');
            if(ov)ov.style.display='none';
            document.getElementById('custPortalScreen').style.display='block';
        };

        if(shops.length===1){ _open(shops[0]); return true; }

        /* أكثر من محل → دع الزبون يختار */
        window._portalShops=shops;
        window._pickPortalShop=(i)=>{
            const pk=document.getElementById('portalShopPicker');
            if(pk)pk.remove();
            _open(window._portalShops[i]);
        };
        const ov=document.getElementById('loginOverlay');
        const pick=document.createElement('div');
        pick.id='portalShopPicker';
        pick.style.cssText='position:fixed;inset:0;z-index:10003;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#1c2438 0%,#0a0f1e 100%);font-family:Tajawal,sans-serif;direction:rtl;padding:1rem';
        pick.innerHTML=`<div style="max-width:360px;width:100%;background:linear-gradient(160deg,rgba(30,39,62,.95),rgba(15,21,38,.96));border-radius:22px;padding:1.2rem;box-shadow:0 0 0 1.5px rgba(212,175,55,.5),0 20px 50px rgba(0,0,0,.6)">
            <div style="text-align:center;font-size:1.6rem">🏪</div>
            <div style="text-align:center;font-weight:900;color:#d4af37;font-size:1.05rem;margin:.3rem 0">اختر المحل</div>
            <div style="text-align:center;font-size:.72rem;color:#9ca3af;margin-bottom:.8rem">رقمك مسجَّل لدى ${shops.length} محلات</div>
            ${shops.map((sh,i)=>`<button onclick="_pickPortalShop(${i})" style="width:100%;margin-bottom:.5rem;padding:.8rem;border-radius:12px;border:1.5px solid rgba(212,175,55,.45);background:rgba(255,255,255,.05);color:#fff;font-family:Tajawal,sans-serif;font-weight:900;font-size:.9rem;cursor:pointer;text-align:right">
                🏪 ${sh.data.shop||sh.key||'محل'}
                <div style="font-size:.62rem;color:#9ca3af;font-weight:700;margin-top:.15rem">${sh.data.name||''} · آخر تحديث ${sh.data.upd?new Date(sh.data.upd).toLocaleDateString('fr-FR'):'—'}</div>
            </button>`).join('')}
            <button onclick="document.getElementById('portalShopPicker').remove();window._portalMode=false" style="width:100%;padding:.55rem;border:none;border-radius:10px;background:rgba(255,255,255,.08);color:#ccc;font-family:Tajawal,sans-serif;font-weight:800;cursor:pointer">← رجوع</button>
        </div>`;
        document.body.appendChild(pick);
        if(ov)ov.style.display='none';
        return true;
    }catch(e){
        window._portalMode=false;
        return false;
    }
};
window._portalInvCache={};
window._renderCustPortal=(d)=>{
    window._portalInvCache=d.inv||{};
    document.getElementById('custPortalName').textContent='👋 '+d.name+(d.shop?' — 🏪 '+d.shop:'');
    document.getElementById('custPortalUpd').textContent='آخر تحديث: '+new Date(d.upd||Date.now()).toLocaleString('fr-FR');
    const dinEl=document.getElementById('custPortalDin');
    const gEl=document.getElementById('custPortalGold');
    /* ⚠️ الأرقام تُنشر باصطلاح المحل (موجب = الزبون مدين للمحل).
       من منظور الزبون تُعكس: ما يسالُه المحل يصير سالباً عليه، وما له عند المحل يصير موجباً. */
    const din=-(Number(d.din)||0)||0, gold=-(Number(d.gold)||0)||0; /* ||0 يمنع ظهور -0 */
    dinEl.textContent=fmt(din,0)+' دج'; dinEl.style.color=din>=0?'#4ade80':'#f87171';
    gEl.textContent=fmt(gold,2)+' غ'; gEl.style.color=gold>=0?'#4ade80':'#f87171';
    /* توضيح نصي تحت كل بطاقة */
    const dinNote=document.getElementById('custPortalDinNote');
    const goldNote=document.getElementById('custPortalGoldNote');
    if(dinNote)dinNote.textContent=Math.abs(din)<0.5?'مُصفّى':(din>0?'لك عند المحل':'عليك للمحل');
    if(goldNote)goldNote.textContent=Math.abs(gold)<0.005?'مُصفّى':(gold>0?'لك عند المحل':'عليك للمحل');
    const opsEl=document.getElementById('custPortalOps');
    const list=Array.isArray(d.ops)?d.ops:Object.values(d.ops||{});
    /* 🔄 عكس تسميات العمليات: ما هو «شراء» عند المحل هو «بيع» عند الزبون */
    const _flipT=(t)=>({
        'شراء سلعة':'🛍️ بعت سلعة للمحل',
        'بيع سلعة':'🛍️ اشتريت سلعة من المحل',
        'شراء':'📋 بعت للمحل',
        'بيع':'📋 اشتريت من المحل',
        'أعطيت':'📥 استلمت من المحل',
        'استلمت':'📤 سلّمت للمحل',
        'تسليم':'📥 استلمت من المحل',
        'استلام':'📤 سلّمت للمحل',
        'سلف':'💰 سلفة',
        'رافيناج':'🔥 رافيناج',
        'تصفية':'✅ تصفية'
    }[t]||t||'');
    opsEl.innerHTML=list.length?list.map(o=>{
        const inv=o.did?window._portalInvCache[o.did]:null;
        const clickable=!!inv;
        const unit=o.m==='دينار'?'دج':'غ';
        let detail='';
        if(inv&&Array.isArray(inv.items))detail=inv.items.map(it=>`<div style="font-size:.62rem;color:#9ca3af">🛍️ ${it.n} · ${fmt(it.w,2)}غ · عيار ${fmt(it.k,0)}${it.p?' · '+fmt(it.p,0)+' دج/غ':''}</div>`).join('');
        if(inv&&inv.rot)detail+=`<div style="font-size:.62rem;color:#2dd4bf">♻️ روتور: ${fmt(inv.rot.w,2)}غ عيار ${fmt(inv.rot.k,0)}</div>`;
        /* الاتجاهات معكوسة من منظور الزبون */
        if(inv&&inv.cash)detail+=`<div style="font-size:.62rem;color:#60a5fa">💵 ${inv.isBuy?'دفعت':'أخذت'} دينار: ${fmt(inv.cash,0)} دج</div>`;
        if(inv&&inv.kass&&inv.kass.eq)detail+=`<div style="font-size:.62rem;color:#2dd4bf">⚱️ ${inv.isBuy?'أخذت لاكاص':'دفعت لاكاص'}: ${fmt(inv.kass.eq,2)} غ (705)</div>`;
        if(inv&&inv.cashiCash)detail+=`<div style="font-size:.62rem;color:#fbbf24">💵 ${inv.isBuy?'أخذت':'دفعت'} كاصي: ${fmt(inv.cashiCash.amt,0)} دج</div>`;
        if(inv&&inv.cashiFee&&inv.cashiFee.din)detail+=`<div style="font-size:.62rem;color:#c4b5fd">⚱️ ${inv.isBuy?'أخذت':'دفعت'} أجرة بالكاصي: ${fmt(inv.cashiFee.din,0)} دج</div>`;
        return `<div onclick="${clickable?`window._viewPortalInv('${o.did}')`:''}"
            style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:.6rem .75rem;margin-bottom:.45rem;${clickable?'cursor:pointer':''}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem">
                <span style="font-weight:900;font-size:.78rem;color:#e5e7eb">${_flipT(o.t)}${clickable?' <span style="font-size:.58rem;color:#d4af37">👁 الفاتورة</span>':''}</span>
                <span style="font-weight:900;font-size:.78rem;color:#d4af37" dir="ltr">${fmt(o.a||0,2)} ${unit}</span>
            </div>
            <div style="font-size:.6rem;color:#6b7280">${o.dt||''}</div>
            ${detail}
        </div>`;
    }).join(''):'<div style="text-align:center;color:#6b7280;padding:1.5rem">لا توجد معاملات بعد</div>';
};
window._viewPortalInv=(did)=>{
    const inv=window._portalInvCache[did]; if(!inv)return;
    let html='';
    try{html=buildDollHtml(inv,true);}catch(e){}  /* true = منظور الزبون */
    if(!html)return;
    let m=document.getElementById('docViewModal');
    if(!m){m=document.createElement('div');m.id='docViewModal';
        m.style.cssText='position:fixed;inset:0;background:#fff;z-index:99999;overflow:auto;display:none';
        document.body.appendChild(m);}
    m.innerHTML=`<button onclick="document.getElementById('docViewModal').style.display='none'"
        style="position:fixed;top:10px;left:10px;z-index:100000;width:40px;height:40px;border-radius:50%;border:none;background:#111;color:#fff;font-size:1.1rem;cursor:pointer">✕</button>
        <div style="max-width:820px;margin:0 auto;padding:1rem">${html}</div>`;
    m.style.display='block';
};

/* ── أسماء السلع (قائمة اختيار مُدارة من الإعدادات، تُزامَن عبر Firebase) ── */
window._goodsNames=window._goodsNames||[];
(function(){ try{ const v=JSON.parse(localStorage.getItem('gp12_goodsNames')||'[]'); if(Array.isArray(v))window._goodsNames=v; }catch(e){} })();
function _persistGoodsNames(){
    try{localStorage.setItem('gp12_goodsNames',JSON.stringify(window._goodsNames));}catch(e){}
    if(window._saveGoodsNamesFb)try{window._saveGoodsNamesFb(window._goodsNames);}catch(e){}
    renderGoodsNamesList(); _refreshGoodsSelects();
}
window.addGoodsName=()=>{
    const inp=document.getElementById('newGoodsName'); if(!inp)return;
    const v=(inp.value||'').trim(); if(!v)return toast('اكتب اسم السلعة أولاً','error');
    if(window._goodsNames.includes(v))return toast('الاسم موجود مسبقاً','error');
    window._goodsNames.push(v); inp.value=''; _persistGoodsNames(); toast('✅ أُضيفت: '+v);
};
window.delGoodsName=(i)=>{
    const n=window._goodsNames[i];
    if(!confirm(`حذف "${n}" من قائمة السلع؟`))return;
    window._goodsNames.splice(i,1); _persistGoodsNames();
};
window.renderGoodsNamesList=()=>{
    const el=document.getElementById('goodsNamesList'); if(!el)return;
    el.innerHTML=window._goodsNames.length
        ?window._goodsNames.map((n,i)=>`<span style="background:var(--card2);border:1px solid var(--border);border-radius:2rem;padding:.2rem .6rem;font-size:.72rem;font-weight:800">${n} <b onclick="delGoodsName(${i})" style="cursor:pointer;color:var(--rd)">✕</b></span>`).join('')
        :'<small style="color:var(--t3)">لا توجد أسماء بعد — أضف أول سلعة</small>';
};
function _goodsOptions(sel){
    let opts=`<option value="">🛍️ السلعة…</option>`+window._goodsNames.map(n=>`<option value="${n}"${n===sel?' selected':''}>${n}</option>`).join('');
    if(sel&&!window._goodsNames.includes(sel))opts+=`<option value="${sel}" selected>${sel}</option>`;
    opts+=`<option value="__new__">＋ اسم جديد…</option>`;
    return opts;
}
/* اختيار "＋ اسم جديد…" من أي قائمة: إدخال فوري يُضاف للقائمة ويُختار */
window._handleGoodsSelect=(el)=>{
    if(el.value!=='__new__')return true;
    const v=(prompt('اسم السلعة الجديد:')||'').trim();
    if(v){
        if(!window._goodsNames.includes(v))window._goodsNames.push(v);
        _persistGoodsNames();
        el.innerHTML=_goodsOptions(v);
        el.value=v;
        return true;
    }
    el.value='';
    return false;
};
window._refreshGoodsSelects=()=>{
    document.querySelectorAll('#goodsRows select.g-n').forEach(el=>{ const v=el.value; el.innerHTML=_goodsOptions(v); });
};
let _dollPaid=true; /* دائماً خالص في نظام السلعة */
window.setDollPaid=(v)=>{ _dollPaid=true; }; /* مُحيَّدة — أزرار خالص/غير خالص أُزيلت */
function _updDollarEq(){} /* مُحيَّدة — لا سعر صرف في نظام السلعة */
window.showDollarBalance=()=>{}; /* مُحيَّدة */
/* ── تبويبات نافذة السلعة: إظهار/إخفاء الأقسام ── */
const _GTAB_COLORS={secRotor:'#d4af37',secCash:'#0369a1',secKass:'#0d9488',secCashi:'#b45309',secCashiFee:'#7c3aed'};
window._toggleGoodsSec=(secId,btn)=>{
    const sec=document.getElementById(secId); if(!sec)return;
    const open=sec.style.display==='none';
    sec.style.display=open?'':'none';
    if(btn){
        const c=_GTAB_COLORS[secId]||'#d4af37';
        btn.style.background=open?c:'transparent';
        btn.style.color=open?'#fff':c;
    }
};
window._resetGoodsSecs=()=>{
    ['secRotor','secCash','secKass','secCashi','secCashiFee'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});
    document.querySelectorAll('.gtab').forEach(b=>{const sec=b.getAttribute('data-sec');const c=_GTAB_COLORS[sec]||'#d4af37';b.style.background='transparent';b.style.color=c;});
};
/* 🪪 بطاقة الزبون الاحترافية عند الضغط على اسمه في الدفتر */
window.openGoodsFor=(name)=>{
    const kind=(window._custKind||{})[name]||'market';
    const isWorkshop=kind==='workshop';
    const di=getCustBal(name,'دينار');
    const dO=getCustBal(name,'دولار');          /* ذهب 705 */
    const g2=getCustBal(name,'ذهب 24');
    const nOps=ops.filter(o=>(o.c||'').toLowerCase()===name.toLowerCase()&&o.t!=='شحن').length;

    const _f=(v,d)=>Math.abs(v).toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
    const _bal=(v,unit,d,isDin)=>{
        if(Math.abs(v)<0.001)return'';
        const owed=v>0;
        const shown=isDin?fmtDin(Math.abs(v)):_f(v,d);
        return`<div style="flex:1;min-width:88px;background:${owed?'rgba(220,38,38,.08)':'rgba(22,163,74,.08)'};
            border:1.5px solid ${owed?'rgba(220,38,38,.35)':'rgba(22,163,74,.35)'};border-radius:12px;padding:.55rem .4rem;text-align:center">
            <div style="font-size:1.05rem;font-weight:900;color:${owed?'#dc2626':'#16a34a'};direction:ltr">${shown}</div>
            <div style="font-size:.58rem;color:var(--t3);font-weight:700;margin-top:.1rem">${unit}</div>
            <div style="font-size:.56rem;font-weight:800;color:${owed?'#dc2626':'#16a34a'}">${owed?'يسالك':'تسالو'}</div>
        </div>`;
    };
    const balCards=[_bal(di,'دينار',0,true),_bal(dO,'ذهب 705 (غ)',2,false),_bal(g2,'ذهب 24 (غ)',2,false)].filter(Boolean).join('')
        ||`<div style="flex:1;text-align:center;padding:.7rem;color:#16a34a;font-weight:800;font-size:.85rem;background:rgba(22,163,74,.06);border-radius:12px">✅ الحساب صافٍ — لا ديون</div>`;

    const tagColor=isWorkshop?'#c2410c':'#0369a1';
    const tagBg=isWorkshop?'rgba(194,65,12,.12)':'rgba(3,105,161,.12)';
    const tagLabel=isWorkshop?'🔧 ورشة':'🏪 سوق';
    const actLabel=isWorkshop?'🛍️ شراء سلعة':'🏷️ بيع سلعة';
    const actType=isWorkshop?'buy':'sell';

    let ov=document.getElementById('custCardOverlay');
    if(!ov){
        ov=document.createElement('div');
        ov.id='custCardOverlay';
        ov.className='modal-overlay';
        document.body.appendChild(ov);
        ov.addEventListener('pointerdown',e=>{if(e.target===ov)ov._os=true;});
        ov.addEventListener('pointerup',e=>{if(e.target===ov&&ov._os){ov.classList.remove('active');}ov._os=false;});
    }
    ov.innerHTML=`<div class="modal" style="max-width:420px">
        <div class="modal-handle"></div>
        <div style="text-align:center;margin-bottom:.6rem">
            <div style="width:56px;height:56px;margin:0 auto .4rem;border-radius:50%;background:linear-gradient(135deg,var(--g400),var(--g600));display:flex;align-items:center;justify-content:center;font-size:1.6rem;color:#fff;box-shadow:0 4px 14px rgba(245,158,11,.35)">👤</div>
            <div style="font-size:1.2rem;font-weight:900;color:var(--t)">${name}</div>
            <span style="display:inline-block;margin-top:.25rem;font-size:.66rem;font-weight:900;color:${tagColor};background:${tagBg};padding:.15rem .6rem;border-radius:1rem">${tagLabel}</span>
            <span style="display:inline-block;margin-top:.25rem;font-size:.62rem;color:var(--t3);margin-right:.3rem">${nOps} معاملة</span>
        </div>

        <div style="font-size:.66rem;font-weight:800;color:var(--t3);margin:.3rem 0 .35rem;text-align:right">💰 الأرصدة الحالية</div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.7rem">${balCards}</div>

        <div style="display:flex;flex-direction:column;gap:.45rem">
            <button onclick="document.getElementById('custCardOverlay').classList.remove('active');openDollar('${actType}','${name.replace(/'/g,"\\'")}')"
                style="width:100%;padding:.8rem;border:none;border-radius:12px;font-family:Tajawal,sans-serif;font-weight:900;font-size:.95rem;cursor:pointer;color:#fff;background:linear-gradient(135deg,${isWorkshop?'#ea580c,#c2410c':'#0ea5e9,#0369a1'});box-shadow:0 4px 14px ${isWorkshop?'rgba(234,88,12,.3)':'rgba(3,105,161,.3)'}">${actLabel}</button>

            <div style="display:flex;gap:.45rem">
                <button onclick="document.getElementById('custCardOverlay').classList.remove('active');openSettle('${name.replace(/'/g,"\\'")}')"
                    style="flex:1;padding:.65rem;border:1.5px solid var(--g500);border-radius:12px;background:transparent;color:var(--g600);font-family:Tajawal,sans-serif;font-weight:900;font-size:.82rem;cursor:pointer">✅ تصفية</button>
                <button onclick="document.getElementById('custCardOverlay').classList.remove('active');viewCustomerLogDirect('${name.replace(/'/g,"\\'")}')"
                    style="flex:1;padding:.65rem;border:1.5px solid #7c3aed;border-radius:12px;background:transparent;color:#7c3aed;font-family:Tajawal,sans-serif;font-weight:900;font-size:.82rem;cursor:pointer">📋 كشف الحساب</button>
            </div>
            <button onclick="document.getElementById('custCardOverlay').classList.remove('active')"
                style="width:100%;padding:.55rem;border:none;border-radius:10px;background:rgba(120,120,120,.12);color:var(--t2);font-family:Tajawal,sans-serif;font-weight:800;font-size:.78rem;cursor:pointer">إغلاق</button>
        </div>
    </div>`;
    ov.classList.add('active');
};
window.openDollar=(t,prefillName)=>{
    const _title=document.getElementById('dollarTitle');
    _title.textContent=t==='buy'?'🛍️ شراء سلعة':'🏷️ بيع سلعة';
    /* رأس ملوّن: أخضر للشراء · أحمر للبيع */
    const _grad=t==='buy'?'linear-gradient(135deg,#16a34a,#15803d)':'linear-gradient(135deg,#dc2626,#b91c1c)';
    _title.style.cssText='margin:-1rem -1rem .6rem;padding:.85rem 1rem;padding-top:calc(.85rem + env(safe-area-inset-top,0px));background:'+_grad+';color:#fff;border-radius:18px 18px 0 0;font-size:1.05rem;font-weight:900;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.15)';
    const _gc=document.getElementById('goodsCustomer');
    _gc.value=prefillName||'';
    _gc.placeholder=t==='buy'?'👤 اسم الزبون — اشتريت منه':'👤 اسم الزبون — بعت له (اختياري)';
    _gc.style.borderColor=t==='buy'?'#16a34a':'#dc2626';
    document.getElementById('goodsRows').innerHTML='';{const _h=document.getElementById('goodsColHead');if(_h)_h.remove();}
    _addGoodsRow();
    ['rotW','rotK','rotP','goodsCash'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    const _cl=document.getElementById('goodsCashLbl');
    if(_cl)_cl.textContent=t==='buy'?'💵 أخذ دينار':'💵 دفع دينار';
    const _kl=document.getElementById('kassLbl');
    if(_kl)_kl.textContent=t==='buy'?'⚱️ دفع لاكاص (تدفعه للزبون)':'⚱️ أخذ لاكاص (تأخذه من الزبون)';
    const _kb=document.getElementById('kassRows');
    if(_kb){_kb.innerHTML='';window._addKassRow();}
    ['cashiAmt','cashiRate'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    const _ccl=document.getElementById('cashiLbl');
    if(_ccl)_ccl.textContent=t==='buy'?'💵 دفع كاصي بالدينار (منه)':'💵 قبض كاصي بالدينار (له)';
    const _cfl=document.getElementById('cashiFeeLbl');
    if(_cfl)_cfl.textContent=t==='buy'?'⚱️ دفع أجرة بالكاصي (منه)':'⚱️ أجرة بالكاصي (له)';
    const _cfb=document.getElementById('cashiFeeRows');
    if(_cfb){_cfb.innerHTML='';window._addCashiFeeRow();}
    const _ce=document.getElementById('cashiEq'); if(_ce)_ce.textContent='';
    if(window._resetGoodsSecs)window._resetGoodsSecs();
    _updGoodsTotal();
    _dollPaid=true;
    document.getElementById('dollarModal').classList.add('active');
    setTimeout(()=>document.getElementById('goodsCustomer').focus(),350);
};
/* ── أسطر السلعة الديناميكية ── */
function _addGoodsRow(vals){
    const box=document.getElementById('goodsRows');
    if(!box||box.children.length>=30)return;
    /* عناوين الأعمدة مرة واحدة في الأعلى */
    if(!box.children.length && !document.getElementById('goodsColHead')){
        const head=document.createElement('div');
        head.id='goodsColHead';
        head.style.cssText='display:flex;gap:.35rem;padding:0 .1rem .15rem;font-size:.56rem;font-weight:800;color:var(--t3)';
        head.innerHTML=`
            <span style="flex:1.4;text-align:center">الصنف</span>
            <span style="flex:1;text-align:center">⚖️ وزن</span>
            <span style="flex:.85;text-align:center">🏷️ عيار</span>
            <span style="flex:1.1;text-align:center">💰 أجرة/غ</span>
            <span style="width:26px"></span>`;
        box.parentNode.insertBefore(head,box);
    }
    const div=document.createElement('div');
    div.className='g-row';
    div.style.cssText='display:flex;gap:.35rem;align-items:center';
    div.innerHTML=`
        <select class="g-n" style="flex:1.4;margin:0;min-width:0">${_goodsOptions(vals&&vals.n?String(vals.n):'')}</select>
        <input type="text" inputmode="decimal" class="g-w" placeholder="⚖️" dir="ltr" style="flex:1;margin:0;min-width:0;text-align:center">
        <input type="text" inputmode="decimal" class="g-k" placeholder="🏷️" dir="ltr" style="flex:.85;margin:0;min-width:0;text-align:center">
        <input type="text" inputmode="decimal" class="g-p" placeholder="💰" dir="ltr" style="flex:1.1;margin:0;min-width:0;text-align:center">
        <button type="button" class="g-del" style="width:26px;height:34px;flex-shrink:0;border:none;border-radius:8px;background:rgba(220,38,38,.1);color:#dc2626;font-size:.9rem;cursor:pointer;padding:0" title="حذف السطر">✕</button>`;
    div.querySelector('select.g-n').addEventListener('change',function(){_handleGoodsSelect(this);_gRowsChanged();});
    div.querySelectorAll('input').forEach(inp=>{
        inp.addEventListener('input',()=>{ liveNum(inp);_gRowsChanged(); });
    });
    div.querySelector('.g-del').addEventListener('click',()=>{
        div.remove();
        /* أبقِ سطراً واحداً على الأقل */
        if(!box.children.length)_addGoodsRow();
        _gRowsChanged();
    });
    if(vals){
        div.querySelector('.g-w').value=vals.w||'';
        div.querySelector('.g-k').value=vals.k||'';
        div.querySelector('.g-p').value=vals.p||'';
    }
    box.appendChild(div);
}
function _rowVal(row,cls){ const el=row.querySelector(cls); return el?el.value.trim():''; }
function _rowNum(row,cls){ const el=row.querySelector(cls); return el?(parseFloat(el.value.replace(/\s/g,'').replace(/,/g,'.'))||0):0; }
function _gRowsChanged(){
    const box=document.getElementById('goodsRows'); if(!box)return;
    const last=box.lastElementChild;
    /* إضافة تلقائية: بمجرد الكتابة في السطر الأخير يظهر سطر جديد */
    if(last&&(_rowVal(last,'.g-n')||_rowVal(last,'.g-w')||_rowVal(last,'.g-k')||_rowVal(last,'.g-p')))_addGoodsRow();
    _updGoodsTotal();
}
function _readGoodsRows(loose){
    const items=[];
    let rowIdx=0;
    document.querySelectorAll('#goodsRows .g-row').forEach(row=>{
        rowIdx++;
        const n=_rowVal(row,'.g-n'), w=_rowNum(row,'.g-w'), k=_rowNum(row,'.g-k'), p=_rowNum(row,'.g-p');
        /* p = سعر الأجرة للغرام الواحد (دج/غ) · fv = الأجرة الكلية للسطر = الوزن × السعر */
        if(w>0&&k>0&&(n||loose))items.push({n:n||'',_row:rowIdx,w,k,p:p>0?p:0,fv:Math.round(w*(p>0?p:0)),eq:Math.round(w*k/705*1000)/1000});
    });
    return items;
}
/* 💵 دفع كاصي بالدينار: المبلغ ÷ السعر = وزن مكافئ (705) · المبلغ يدخل السيولة */
function _readCashiCash(){
    const amt=readNum('cashiAmt'),rate=readNum('cashiRate');
    if(!(amt>0&&rate>0))return null;
    return {amt,rate,eq:Math.round(amt/rate*1000)/1000};
}
/* ⚱️ دفع أجرة بالكاصي: (وزن×عيار÷705)×سعر = دينار · السبيكة تدخل مخزون 705 */
window._addCashiFeeRow=(vals)=>{
    const box=document.getElementById('cashiFeeRows');
    if(!box||box.children.length>=20)return;
    const div=document.createElement('div');
    div.className='cf-row';
    div.style.cssText='display:flex;gap:.35rem;align-items:center';
    div.innerHTML=`
        <input type="text" inputmode="decimal" class="cf-w" placeholder="⚖️ الوزن" dir="ltr" style="flex:1;margin:0;min-width:0;text-align:right">
        <input type="text" inputmode="decimal" class="cf-k" placeholder="🏷️ العيار" dir="ltr" style="flex:.9;margin:0;min-width:0;text-align:right">
        <input type="text" inputmode="decimal" class="cf-p" placeholder="💰 السعر/غ" dir="ltr" style="flex:1;margin:0;min-width:0;text-align:right">
        <span class="cf-eq" style="flex:1;min-width:0;font-size:.68rem;font-weight:800;color:#7c3aed;align-self:center;text-align:left" dir="ltr"></span>`;
    div.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{liveNum(inp);_cashiFeeChanged();}));
    if(vals){div.querySelector('.cf-w').value=vals.w||'';div.querySelector('.cf-k').value=vals.k||'';div.querySelector('.cf-p').value=vals.p||'';}
    box.appendChild(div);
};
function _cashiFeeChanged(){
    const box=document.getElementById('cashiFeeRows'); if(!box)return;
    box.querySelectorAll('.cf-row').forEach(row=>{
        const w=_rowNum(row,'.cf-w'),k=_rowNum(row,'.cf-k'),p=_rowNum(row,'.cf-p');
        row.querySelector('.cf-eq').textContent=(w>0&&k>0&&p>0)?('= '+fmt(Math.round(w*k/705*p),0)+' دج'):'';
    });
    const last=box.lastElementChild;
    if(last&&(_rowVal(last,'.cf-w')||_rowVal(last,'.cf-k')||_rowVal(last,'.cf-p')))window._addCashiFeeRow();
    _updGoodsTotal();
}
function _readCashiFee(){
    const items=[];
    document.querySelectorAll('#cashiFeeRows .cf-row').forEach(row=>{
        const w=_rowNum(row,'.cf-w'),k=_rowNum(row,'.cf-k'),p=_rowNum(row,'.cf-p');
        if(w>0&&k>0&&p>0)items.push({w,k,p,eq:Math.round(w*k/705*1000)/1000,din:Math.round(w*k/705*p)});
    });
    return {items,din:items.reduce((s,it)=>s+it.din,0),eq:Math.round(items.reduce((s,it)=>s+it.eq,0)*1000)/1000};
}
/* ⚱️ لاكاص: أسطر وزن + عيار بإضافة تلقائية — مكافئ 705 يدخل الديون */
window._addKassRow=(vals)=>{
    const box=document.getElementById('kassRows');
    if(!box||box.children.length>=20)return;
    const div=document.createElement('div');
    div.className='ks-row';
    div.style.cssText='display:flex;gap:.35rem';
    div.innerHTML=`
        <input type="text" inputmode="decimal" class="ks-w" placeholder="⚖️ الوزن" dir="ltr" style="flex:1;margin:0;min-width:0;text-align:right">
        <input type="text" inputmode="decimal" class="ks-k" placeholder="🏷️ العيار" dir="ltr" style="flex:1;margin:0;min-width:0;text-align:right">
        <span class="ks-eq" style="flex:1;min-width:0;font-size:.72rem;font-weight:800;color:#0d9488;align-self:center;text-align:left" dir="ltr"></span>`;
    div.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{liveNum(inp);_kassChanged();}));
    if(vals){div.querySelector('.ks-w').value=vals.w||'';div.querySelector('.ks-k').value=vals.k||'';}
    box.appendChild(div);
};
function _kassChanged(){
    const box=document.getElementById('kassRows'); if(!box)return;
    /* مكافئ كل سطر يظهر بجانبه فوراً */
    box.querySelectorAll('.ks-row').forEach(row=>{
        const w=_rowNum(row,'.ks-w'),k=_rowNum(row,'.ks-k');
        row.querySelector('.ks-eq').textContent=(w>0&&k>0)?('= '+fmt(Math.round(w*k/705*1000)/1000,2)+' غ 705'):'';
    });
    const last=box.lastElementChild;
    if(last&&(_rowVal(last,'.ks-w')||_rowVal(last,'.ks-k')))window._addKassRow();
    _updGoodsTotal();
}
function _readKass(){
    const items=[];
    document.querySelectorAll('#kassRows .ks-row').forEach(row=>{
        const w=_rowNum(row,'.ks-w'),k=_rowNum(row,'.ks-k');
        if(w>0&&k>0)items.push({w,k,eq:Math.round(w*k/705*1000)/1000});
    });
    return {items,eq:Math.round(items.reduce((s,it)=>s+it.eq,0)*1000)/1000};
}
/* ♻️ الروتور (مرتجع): في الشراء أنت تُرجعه للزبون فينقص من مشترياتك وأجرتها، وفي البيع يعود إليك */
function _readRotor(){
    const rw=readNum('rotW'),rk=readNum('rotK'),rp=readNum('rotP');
    if(!(rw>0&&rk>0))return null;
    return {w:rw,k:rk,p:rp>0?rp:0,fv:Math.round(rw*(rp>0?rp:0)),eq:Math.round(rw*rk/705*1000)/1000};
}
/* الوزن المتاح في المخزون لاسم سلعة معيّن */
function _stockAvail(name){ return goodsStock.filter(g=>g.n===name).reduce((s,g)=>s+(g.w||0),0); }
function _updGoodsTotal(){
    const _tt=document.getElementById('dollarTitle');
    const isBuyNow=!!(_tt&&_tt.textContent.includes('شراء'));
    const items=_readGoodsRows(true); /* المجاميع تحسب كل سطر رقمي حتى قبل اختيار الاسم */
    const rot=_readRotor();
    const w=items.reduce((s,it)=>s+it.w,0);
    const eq=items.reduce((s,it)=>s+it.eq,0);
    const fee=items.reduce((s,it)=>s+it.fv,0);
    const el=document.getElementById('goodsTotal');
    if(!el)return;
    const cash=readNum('goodsCash');
    const kass=_readKass();
    const cashiCash=_readCashiCash();
    const cashiFee=_readCashiFee();
    const _ce=document.getElementById('cashiEq');
    if(_ce)_ce.textContent=cashiCash?('= '+fmt(cashiCash.eq,2)+' غ (705)'):'';
    let txt=`🛍️ ${fmt(w,2)} غ · مكافئ 705: ${fmt(eq,2)} غ · أجرة ${fmt(fee,0)} دج`;
    if(rot)txt+=` − ♻️ روتور ${fmt(rot.eq,2)} غ (705) · ${fmt(rot.fv,0)} دج`;
    if(kass.eq>0)txt+=` − ⚱️ ${isBuyNow?'دفع':'أخذ'} لاكاص ${fmt(kass.eq,2)} غ (705)`;
    if(cash>0)txt+=` − 💵 ${fmt(cash,0)} دج`;
    const netEq=eq-(rot?rot.eq:0)-kass.eq;
    const netFee=fee-(rot?rot.fv:0)-cash;
    if(rot||kass.eq>0||cash>0)txt+=` = الصافي: ${fmt(netEq,2)} غ (705) · ${fmt(netFee,0)} دج`;
    el.textContent=txt;
}
window.saveDollar=()=>{
    const cust=document.getElementById('goodsCustomer').value.trim();
    const loose=_readGoodsRows(true);
    const noName=loose.find(it=>!it.n);
    if(noName)return toast(`⚠️ اختر اسم السلعة في السطر ${noName._row} — أضف الأسماء من ⚙ الإعدادات أو اختر «＋ اسم جديد…» من القائمة`,'error');
    const items=loose;
    if(!cust)return toast('أدخل اسم الزبون','error');
    const isBuy=document.getElementById('dollarTitle').textContent.includes('شراء');
    const rot=_readRotor();
    const cash=readNum('goodsCash')>0?readNum('goodsCash'):0;
    const kass=_readKass();
    const cashiCash=_readCashiCash();
    const cashiFee=_readCashiFee();
    if(!items.length&&!rot&&!cash&&!kass.eq&&!cashiCash&&!cashiFee.eq)return toast('أدخل سطراً مكتملاً واحداً على الأقل','error');
    /* المتاح بمكافئ 705 من كل مخزن (عيار 1000 يستعمل مخزون 24) */
    const _av705=()=>(g730||[]).reduce((s,b)=>s+(b.w||0)*((b.k||730)/705),0);
    const _av24 =()=>(g24 ||[]).reduce((s,b)=>s+(b.w||0)*((b.k||1000)/705),0);
    /* يفصل بنود الدفع حسب المخزن المستهدف */
    const _needByPool=(its)=>{
        let n705=0,n24=0;
        (its||[]).forEach(it=>{
            const k=Number(it.k)||705, e=(Number(it.w)||0)*k/705;
            if(k>=999)n24+=e; else n705+=e;
        });
        return {n705:Math.round(n705*1000)/1000,n24:Math.round(n24*1000)/1000};
    };
    /* الشراء: أخذ الدينار يخرج من السيولة — تحقق من الكفاية */
    if(isBuy&&cash>0&&B.دينار<cash-0.001)return toast('⚠️ السيولة (الدينار) غير كافية لهذا الأخذ','error');
    /* دفع أجرة بالكاصي عند الشراء: السبيكة تخرج من مخزون 705 — تحقق من الكفاية */
    if(isBuy&&cashiFee.eq>0){
        const nd=_needByPool(cashiFee.items);
        if(nd.n705>_av705()+0.001)
            return toast(`⚠️ مخزون 705 غير كافٍ لأجرة الكاصي — متاح ${fmt(_av705(),2)} غ (705) والمطلوب ${fmt(nd.n705,2)}`,'error');
        if(nd.n24>_av24()+0.001)
            return toast(`⚠️ مخزون 24 غير كافٍ لأجرة الكاصي — متاح ${fmt(_av24(),2)} غ (بمكافئ 705) والمطلوب ${fmt(nd.n24,2)}`,'error');
    }
    /* الشراء مع روتور: أنت تُرجع الروتور للزبون — يجب أن يكفي مخزون «روتور» */
    if(isBuy&&rot){
        const _rAvail=_stockAvail('روتور');
        if(rot.w>_rAvail+0.0005)
            return toast(`⚠️ مخزون «روتور» غير كافٍ لإرجاعه — متاح ${fmt(_rAvail,2)} غ والمطلوب ${fmt(rot.w,2)} غ`,'error');
    }
    /* الشراء مع لاكاص: السبيكة تخرج من مخزون 705 — يجب أن يكفي المخزون بالمكافئ */
    if(isBuy&&kass.eq>0){
        const nd=_needByPool(kass.items);
        if(nd.n705>_av705()+0.001)
            return toast(`⚠️ مخزون 705 غير كافٍ للاكاص — متاح ${fmt(_av705(),2)} غ (705) والمطلوب ${fmt(nd.n705,2)}`,'error');
        if(nd.n24>_av24()+0.001)
            return toast(`⚠️ مخزون 24 غير كافٍ للاكاص — متاح ${fmt(_av24(),2)} غ (بمكافئ 705) والمطلوب ${fmt(nd.n24,2)}`,'error');
    }
    const equiv=Math.round(items.reduce((s,it)=>s+it.eq,0)*1000)/1000;
    const fee=items.reduce((s,it)=>s+it.fv,0);
    /* 🚫 البيع لا يخصم سلعة من سلعة أخرى: كل اسم يُخصم من مخزونه هو فقط */
    if(!isBuy){
        const need={};
        items.forEach(it=>{ need[it.n]=(need[it.n]||0)+it.w; });
        for(const nm in need){
            const avail=_stockAvail(nm);
            if(need[nm]>avail+0.0005)
                return toast(`⚠️ مخزون «${nm}» غير كافٍ — متاح ${fmt(avail,2)} غ والمطلوب ${fmt(need[nm],2)} غ`,'error');
        }
    }
    const did='DOLL-'+uid();
    const dt=new Date().toLocaleDateString('fr-FR');
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    /* gv:2 — دائماً غير خالص: الشراء يُسجّل ديناً بالأحمر (سلعة مكافئ 705 + الأجرة بالدينار)، والبيع بالعكس */
    const _di={id:did,c:cust,isBuy,a:equiv,fee,dt,items,gv:2,rot:rot||undefined,cash:cash||undefined,kass:kass.eq>0?kass:undefined,cashiCash:cashiCash||undefined,cashiFee:cashiFee.eq>0?cashiFee:undefined};
    /* 🏷️ اسم العملية يعكس ما حدث فعلاً — لا «بيع سلعة» على عملية دينار صرفة */
    const _hasGoods=items.some(it=>(it.w||0)>0.001)||(kass.eq>0)||(cashiFee&&cashiFee.eq>0);
    const _cashAmt=(cash||0)+((cashiCash&&cashiCash.amt)||0);
    const _hasCash=_cashAmt>0.001;
    let _opName=isBuy?'شراء سلعة':'بيع سلعة';
    let _opM='دولار', _opA=Math.round((equiv-(rot?rot.eq:0))*1000)/1000;
    if(!_hasGoods&&_hasCash){
        /* دينار فقط بلا ذهب: المبلغ بالدينار، والاسم يعكس الاتجاه */
        _opName=isBuy?'قبض دينار':'دفع دينار';
        _opM='دينار';
        _opA=_cashAmt;
    }
    emitEvent('DOLLAR',
        {gv:2,c:cust,isBuy,items,equiv,fee,a:equiv,r:0,rot:rot||null,cash:cash||0,kass:kass.eq>0?kass:null,cashiCash:cashiCash||null,cashiFee:cashiFee.eq>0?cashiFee:null},
        {dollInvoice:_di,op:{c:cust,t:_opName,m:_opM,a:_opA,fee,_ts:Date.now(),dt:nowStr,did,gItems:items.length,rotW:rot?rot.w:0}}
    );
    window._editRestore=null;
    closeModal('dollarModal');
    const _netEq=Math.round((equiv-(rot?rot.eq:0))*1000)/1000,_netFee=fee-(rot?rot.fv:0);
    toast(isBuy
        ?`✅ شراء ${items.length} سلعة${rot?' − روتور':''} — صافي الدين: ${fmt(_netEq,2)} غ (705) + ${fmt(_netFee,0)} دج بالأحمر · حُفظت الفاتورة`
        :`✅ بيع ${items.length} سلعة${rot?' − روتور':''} — الصافي: ${fmt(_netEq,2)} غ (705) + ${fmt(_netFee,0)} دج بالأخضر · حُفظت الفاتورة`);
};
/* ── مخزون السلعة ── */
window.openGoodsStock=()=>{
    renderGoodsStock();
    document.getElementById('goodsStockModal').classList.add('active');
};
window.renderGoodsStock=()=>{
    const cntEl=document.getElementById('goodsStockCount');
    const listEl=document.getElementById('goodsStockList');
    if(!cntEl||!listEl)return;
    cntEl.textContent=goodsStock.length;
    listEl.innerHTML=goodsStock.length?goodsStock.map(g=>`
        <div class="saved-card">
            <div>
                <strong>🛍️ ${g.n}</strong>
                <span style="color:var(--g600);font-weight:900;margin-right:.3rem">⚖️ ${fmt(g.w,2)} غ</span>
                ${g.k?`<span style="color:var(--pu);font-weight:800;margin-right:.3rem">🏷️ عيار ${fmt(g.k,0)}</span>`:''}
                <small style="color:var(--t2);display:block;font-size:.62rem">المصدر: ${g.src||'—'} · الأجرة: ${fmt(g.p||0,0)} دج/غ${g.dt?' · '+g.dt:''}</small>
            </div>
        </div>`).join(''):'<div style="text-align:center;color:var(--t3);padding:1.2rem">لا توجد سلع في المخزون</div>';
};

/* ═══════════ تعديل الفواتير (دولار/دبي/رافيناج) — إبطال ثم فتح معبّأ، مع استرجاع عند الإلغاء ═══════════ */
window._editRestore=null;
window._flushPendingEdit=()=>{
    const er=window._editRestore; if(!er)return;
    window._editRestore=null;
    if(typeof _reemitSnapshot==='function')_reemitSnapshot(er.snap);
    if(typeof _hideRafEditBanner==='function')_hideRafEditBanner();
};
window.editDoll=(id)=>{
    _flushPendingEdit();
    const d=dollInvoices.find(x=>x.id===id); if(!d)return;
    if(!confirm('تعديل عملية السلعة؟ ستُحذف القديمة وتُفتح للتعديل، ثم احفظ.'))return;
    const snap=_invSnapshot('dollInvoice',id); if(!snap){toast('تعذّر التعديل','error');return;}
    _voidByInvId('dollInvoice',id);
    openDollar(d.isBuy?'buy':'sell');
    document.getElementById('goodsCustomer').value=(d.c&&d.c!=='—')?d.c:'';
    document.getElementById('goodsRows').innerHTML='';{const _h=document.getElementById('goodsColHead');if(_h)_h.remove();}
    const _all=Array.isArray(d.items)&&d.items.length?d.items:[{n:d.c||'',w:d.gw||'',k:d.gk||'',p:d.a||''}];
    const _rot=d.rot||_all.find(it=>it.n==='روتور'||it.rot);
    if(_rot){
        const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v!=null&&v!==0?v:'';};
        set('rotW',_rot.w);set('rotK',_rot.k);set('rotP',_rot.p);
    }
    const _its=_all.filter(it=>!(it.n==='روتور'||it.rot));
    _its.forEach(it=>_addGoodsRow({n:it.n,w:it.w||'',k:it.k||'',p:it.p!=null?it.p:(it.a||'')}));
    if(d.cash){const el=document.getElementById('goodsCash');if(el)el.value=d.cash;}
    if(d.kass&&Array.isArray(d.kass.items)){
        const kb=document.getElementById('kassRows');
        if(kb){kb.innerHTML='';d.kass.items.forEach(it=>window._addKassRow({w:it.w,k:it.k}));window._addKassRow();_kassChanged();}
    }
    if(d.cashiCash){const a=document.getElementById('cashiAmt'),r=document.getElementById('cashiRate');if(a)a.value=d.cashiCash.amt;if(r)r.value=d.cashiCash.rate;}
    if(d.cashiFee&&Array.isArray(d.cashiFee.items)){
        const cb=document.getElementById('cashiFeeRows');
        if(cb){cb.innerHTML='';d.cashiFee.items.forEach(it=>window._addCashiFeeRow({w:it.w,k:it.k,p:it.p}));window._addCashiFeeRow();_cashiFeeChanged();}
    }
    /* افتح الأقسام التي تحتوي بيانات */
    const _openIf=(cond,sec)=>{if(cond){const e=document.getElementById(sec);if(e&&e.style.display==='none'){const btn=document.querySelector(`.gtab[data-sec="${sec}"]`);_toggleGoodsSec(sec,btn);}}};
    _openIf(_rot,'secRotor');
    _openIf(d.cash,'secCash');
    _openIf(d.kass&&d.kass.items&&d.kass.items.length,'secKass');
    _openIf(d.cashiCash,'secCashi');
    _openIf(d.cashiFee&&d.cashiFee.items&&d.cashiFee.items.length,'secCashiFee');
    _updGoodsTotal();
    _addGoodsRow(); /* سطر فارغ للإضافة */
    _updGoodsTotal();
    window._editRestore={modalId:'dollarModal',snap};
    toast('✏️ عدّل ثم احفظ','info');
};
window.editDubInv=(id)=>{
    _flushPendingEdit();
    const d=dubaiInvoices.find(x=>x.id===id); if(!d)return;
    if(!confirm('تعديل عملية دبي؟ ستُحذف القديمة وتُفتح للتعديل، ثم احفظ.'))return;
    const snap=_invSnapshot('dubaiInvoice',id); if(!snap){toast('تعذّر التعديل','error');return;}
    _voidByInvId('dubaiInvoice',id);
    openDubai();
    document.getElementById('dubaiOffice').value=d.c||'';
    document.getElementById('dubaiWeight').value=d.w!=null?d.w:'';
    document.getElementById('dubaiPrice').value=d.sp!=null?d.sp:'';
    document.getElementById('dubaiDisc').value=d.disc!=null?d.disc:'0';
    try{document.getElementById('dubaiWeight').dispatchEvent(new Event('input'));}catch(e){}
    window._editRestore={modalId:'dubaiModal',snap};
    toast('✏️ عدّل ثم احفظ','info');
};
window.editRafInv=(id)=>{
    _flushPendingEdit();
    const r=rafInvoices.find(x=>x.id===id); if(!r)return;
    if(typeof _invBarsConsumedF==='function' && _invBarsConsumedF('rafInvoice',id)){
        toast('🚫 لا يمكن تعديل رافيناج خرج اللانقو المستلَم منه من الكوفر حتى لا تتلخبط الحسابات','error');
        return;
    }
    if(!confirm('تعديل عملية الرافيناج؟ ستُحذف القديمة وتُفتح للتعديل، ثم احفظ.'))return;
    const snap=_invSnapshot('rafInvoice',id); if(!snap){toast('تعذّر التعديل','error');return;}
    _voidByInvId('rafInvoice',id);
    switchPage('raffinage');
    document.getElementById('rafCustomer').value=r.c||'';
    const rows=r.rows||[];
    if(typeof rafRows!=='undefined'){ rafRows=Math.max(rafRows||5,rows.length); }
    if(typeof initRafTable==='function')initRafTable();
    rows.forEach((row,idx)=>{
        const i=idx+1;
        const we=document.getElementById('rafW_'+i), ke=document.getElementById('rafK_'+i);
        if(we)we.value=row.w!=null?row.w:'';
        if(ke)ke.value=row.k!=null?row.k:'';
    });
    const setV=(id,v)=>{const el=document.getElementById(id);if(el)el.value=(v!=null?v:'0');};
    setV('rafFee',r.feeRate); setV('rafSawared',r.sawared); setV('rafLanqo',r.lanqo);
    if(typeof calcRaf==='function')calcRaf();
    window._editRestore={page:'raffinage',snap};
    _showRafEditBanner();
    toast('✏️ عدّل ثم احفظ','info');
};
function _showRafEditBanner(){
    let b=document.getElementById('rafEditBanner');
    if(!b){
        b=document.createElement('div');
        b.id='rafEditBanner';
        b.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;background:#c2410c;color:#fff;border-radius:10px;padding:.45rem .8rem;display:flex;align-items:center;gap:.7rem;box-shadow:0 4px 16px rgba(194,65,12,.4);font-family:Tajawal,sans-serif;font-size:.82rem';
        document.body.appendChild(b);
    }
    b.innerHTML=`✏️ وضع تعديل الرافيناج <button onclick="cancelRafEdit()" style="background:rgba(255,255,255,.25);border:none;color:#fff;border-radius:6px;padding:.2rem .65rem;font-weight:800;cursor:pointer;font-family:inherit">إلغاء</button>`;
    b.style.display='flex';
}
window._hideRafEditBanner=()=>{ const b=document.getElementById('rafEditBanner'); if(b)b.style.display='none'; };
window.cancelRafEdit=()=>{ _flushPendingEdit(); if(typeof resetRafForm==='function')resetRafForm(); toast('↩️ أُلغي التعديل واستُعيدت الفاتورة','info'); };

/* ═══════════ SHIPPING ═══════════ */
window.openShipping=()=>{
    document.getElementById('shipWeight').value='';document.getElementById('shipPrice').value='';document.getElementById('shipOffice').value='';
    document.getElementById('shipModal').classList.add('active');
    setTimeout(()=>document.getElementById('shipWeight').focus(),350);
};
window.saveShip=()=>{
    const w=parseFloat(document.getElementById('shipWeight').value);
    const p=parseFloat(document.getElementById('shipPrice').value)||0;
    const o=document.getElementById('shipOffice').value.trim();
    if(isNaN(w)||w<=0||!o)return toast('تأكد من البيانات','error');
    if(B['ذهب 24']<w-0.001)return toast('⚠️ مخزون سبائك 24 غير كافٍ','error');
    const rc=Math.round(w*999/1000*100)/100;
    const {barsRemove,barUpdates}=_pickBarsToRemove('24',w);
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    emitEvent('SHIP',
        {o,w,rc,p,barsRemove,barUpdates},
        {op:{c:o,t:'شحن',m:'ذهب 24',a:w,_ts:Date.now(),dt:nowStr,sp:p,rc}}
    );
    closeModal('shipModal');
    toast('🚢 تم إرسال الشحنة');
    printShipPDF({office:o,weight:w,received:rc,price:p});
};

function printShipPDF({office,weight,received,price}){
    const now=new Date();
    const dateStr=now.toLocaleDateString('ar-DZ',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    const timeStr=now.toLocaleTimeString('ar-DZ',{hour:'2-digit',minute:'2-digit'});
    const user=document.getElementById('currentUserDisplay').textContent||'—';
    const totalUSD=price>0?(received*price).toFixed(2):null;
    const invoiceNum='SH-'+Date.now().toString().slice(-6);

    const html=`<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<title>فاتورة شحن ${invoiceNum}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#111;padding:2cm;font-size:14px}
.logo{text-align:center;margin-bottom:1.5rem}
.logo h1{font-size:2rem;color:#b8860b;letter-spacing:1px}
.logo p{color:#666;font-size:.9rem}
.title{text-align:center;font-size:1.4rem;font-weight:700;color:#b8860b;margin:1rem 0;
       border-top:2px solid #b8860b;border-bottom:2px solid #b8860b;padding:.5rem}
.meta{display:flex;justify-content:space-between;margin-bottom:1.5rem;color:#555;font-size:.85rem}
table{width:100%;border-collapse:collapse;margin:1rem 0}
th{background:#b8860b;color:#fff;padding:.6rem 1rem;text-align:right;font-size:.95rem}
td{padding:.6rem 1rem;border-bottom:1px solid #e5e0d0;font-size:.95rem}
tr:last-child td{border-bottom:none}
.total-row td{font-weight:700;font-size:1.1rem;color:#b8860b;border-top:2px solid #b8860b}
.footer{margin-top:2rem;text-align:center;color:#999;font-size:.8rem;border-top:1px solid #ddd;padding-top:1rem}
.sign{margin-top:3rem;display:flex;justify-content:space-between}
.sign div{text-align:center;width:40%}
.sign div p:first-child{border-top:1px solid #aaa;padding-top:.3rem;color:#555;font-size:.85rem}
@media print{body{padding:1cm}.no-print{display:none}}
</style>
</head>
<body>
<div class="logo">
    <h1>🥇 GoldPro</h1>
    <p>نظام إدارة الذهب</p>
</div>
<div class="title">🚢 فاتورة شحن</div>
<div class="meta">
    <span>رقم الفاتورة: <strong>${invoiceNum}</strong></span>
    <span>${dateStr} — ${timeStr}</span>
    <span>المستخدم: <strong>${user}</strong></span>
</div>
<table>
    <thead><tr><th>البيان</th><th>القيمة</th></tr></thead>
    <tbody>
        <tr><td>المكتب / الجهة المستلِمة</td><td><strong>${office}</strong></td></tr>
        <tr><td>الوزن المُرسَل</td><td><strong>${weight.toFixed(3)} غ</strong> (ذهب 24)</td></tr>
        <tr><td>الوزن المستلَم (بعد خصم 0.1٪)</td><td><strong>${received.toFixed(3)} غ</strong></td></tr>
        ${price>0?`<tr><td>سعر الغرام</td><td>${price} $/غ</td></tr>`:''}
        ${totalUSD?`<tr class="total-row"><td>القيمة الإجمالية</td><td>${totalUSD} $</td></tr>`:''}
    </tbody>
</table>
<div class="sign">
    <div><p>توقيع المُرسِل</p><br><br></div>
    <div><p>توقيع المُستلِم</p><br><br></div>
</div>
<div class="footer">GoldPro — وثيقة رسمية للشحن | ${dateStr}</div>
<script>window.onload=()=>{window.print();}<\/script>
</body></html>`;

    const w2=window.open('','_blank','width=800,height=700');
    if(w2){w2.document.write(html);w2.document.close();}
    else toast('فعّل النوافذ المنبثقة لطباعة الفاتورة','error');
}

/* ═══════════ EXPENSE ═══════════ */
window.toggleExpCur=()=>{};
window.openExpense=()=>{
    document.getElementById('expAmount').value='';
    document.getElementById('expNote').value='';
    document.getElementById('expCustomer').value='';
    /* المصاريف بالدينار فقط (خيار الدولار محذوف) */
    const _ec=document.querySelector('input[name="expCur"][value="دينار"]'); if(_ec)_ec.checked=true;
    const _ecw=document.getElementById('expCustomerWrap'); if(_ecw)_ecw.style.display='none';
    document.getElementById('expAmount').placeholder='💰 القيمة (دج)';
    document.getElementById('expModal').classList.add('active');
    setTimeout(()=>document.getElementById('expAmount').focus(),350);
};
window.saveExp=()=>{
    const a=readNum('expAmount');
    const n=document.getElementById('expNote').value.trim();
    const cur=document.querySelector('input[name="expCur"]:checked').value;
    if(!a||a<=0)return toast('حدد قيمة المصروف','error');
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    if(cur==='دولار'){
        const cust=document.getElementById('expCustomer').value.trim();
        if(!cust)return toast('أدخل اسم الزبون للمصاريف بالسلعة','error');
        emitEvent('EXPENSE',{cur,a,n,cust},{op:{c:cust,t:'مصاريف',m:'دولار',a,_ts:Date.now(),dt:nowStr,note:n}});
        closeModal('expModal');
        toast(`💸 مصاريف ${a.toLocaleString('fr-FR')}$ — مسجّلة لصالح ${cust} (علينا له)`);
    }else{
        if(B.دينار<a-0.001)return toast('⚠️ السيولة غير كافية','error');
        emitEvent('EXPENSE',{cur,a,n},{op:{c:n||'مصاريف',t:'مصاريف',m:'دينار',a,_ts:Date.now(),dt:nowStr}});
        closeModal('expModal');toast('💸 تم خصم المصروف');
    }
};

/* ═══════════ DUBAI ═══════════ */
window.openDubai=()=>{
    document.getElementById('dubaiOffice').value='';document.getElementById('dubaiWeight').value='';
    /* تعبئة سعر الشاشة اللحظي تلقائياً */
    document.getElementById('dubaiPrice').value=liveSpotPrice>0?liveSpotPrice:'';
    document.getElementById('dubaiDisc').value='0';
    document.getElementById('dubaiTotal').textContent='💰 0 USD';
    document.getElementById('dubaiModal').classList.add('active');
    setTimeout(()=>document.getElementById('dubaiOffice').focus(),350);
};
const _modalFields={
    dubaiFields:['dubaiOffice','dubaiWeight','dubaiPrice','dubaiDisc'],
    shipFields:['shipWeight','shipPrice','shipOffice'],
};
const _modalSave={
    dubaiFields:()=>saveDubai(),
    shipFields:()=>saveShip(),
};
window.modalNav=(e,group,idx)=>{
    const fields=_modalFields[group];
    if(e.key==='ArrowDown'||e.key==='Enter'){
        e.preventDefault();
        if(idx<fields.length-1)document.getElementById(fields[idx+1]).focus();
        else _modalSave[group]();
    }else if(e.key==='ArrowUp'){
        e.preventDefault();
        if(idx>0)document.getElementById(fields[idx-1]).focus();
    }
};
/* alias للتوافق مع dubaiNav القديم */
window.dubaiNav=(e,idx)=>modalNav(e,'dubaiFields',idx);
/* ══ حاسبة سعر البيع في دبي ══ */
/* مفتاح خاص بحاسبة دبي — خارج نطاق gp12_ حتى لا يُمسح عند إعادة الضبط */
const _dcKey=()=>'dc_calc_vals_'+(typeof _SITE!=='undefined'&&_SITE?_SITE+'_':'')+(_currentUser||'_');
window._dubaiCalcVals=null;
window._loadDubaiCalc=()=>{ try{ window._dubaiCalcVals=JSON.parse(localStorage.getItem(_dcKey())||'null'); }catch(e){ window._dubaiCalcVals=null; } if(window._dubaiCalcVals&&typeof _applyDubaiCalcSettings==='function')_applyDubaiCalcSettings(window._dubaiCalcVals); };
function _saveDubaiCalcInputs(){
    const vals={
        disc    :document.getElementById('dcDisc').value,
        ship    :document.getElementById('dcShip').value,
        dollar  :document.getElementById('dcDollar').value,
        expenses:document.getElementById('dcExpenses').value
    };
    try{localStorage.setItem(_dcKey(),JSON.stringify(vals));}catch(e){}
    window._dubaiCalcVals=vals;
    /* مزامنة عبر الأجهزة: تُحفظ ضمن إعدادات Firebase */
    if(typeof _scheduleSave==='function')_scheduleSave();
}
/* تطبيق إعدادات دبي الواردة من جهاز آخر */
window._applyDubaiCalcSettings=(vals)=>{
    if(!vals||typeof vals!=='object')return;
    try{localStorage.setItem(_dcKey(),JSON.stringify(vals));}catch(e){}
    window._dubaiCalcVals=vals;
    const set=(id,v)=>{const e=document.getElementById(id); if(e&&v!==undefined&&document.activeElement!==e)e.value=v;};
    set('dcDisc',vals.disc); set('dcShip',vals.ship); set('dcDollar',vals.dollar); set('dcExpenses',vals.expenses);
    if(typeof _refreshDubaiSell==='function')_refreshDubaiSell();
    const m=document.getElementById('dubaiCalcModal');
    if(m&&m.classList.contains('active')&&typeof calcDubaiSell==='function')calcDubaiSell();
};

/* ═══════════ تصوير السبائك → Google Vision OCR → تعبئة الفاتورة ═══════════ */
const _VISION_KEY='gp_vision_key';
function _getVisionKey(){
    const s=(typeof window!=='undefined'&&window._sharedVisionKey)||'';
    if(s)return s;
    try{return localStorage.getItem(_VISION_KEY)||'';}catch(e){return '';}
}
window.saveVisionKey=()=>{
    const v=(document.getElementById('visionKeyInput').value||'').trim();
    try{localStorage.setItem(_VISION_KEY,v);}catch(e){}
    if(typeof _saveSharedVisionKey==='function'){
        _saveSharedVisionKey(v)
            .then(()=>toast(v?'✅ حُفظ المفتاح لكل المستخدمين':'تم مسح المفتاح','success'))
            .catch(()=>toast('✅ حُفظ بجهازك (تعذّر الحفظ المشترك — تأكّد من القواعد)','info'));
    }else{
        toast(v?'✅ حُفظ المفتاح':'تم مسح المفتاح','info');
    }
};
window.onBarPhoto=(e)=>{
    const file=e.target.files&&e.target.files[0]; if(!file)return; e.target.value='';
    const key=_getVisionKey();
    if(!key){ toast('⚠️ أدخل مفتاح Google Vision في الإعدادات أولاً','error'); return; }
    toast('📷 جاري قراءة الصورة...','info');
    const fr=new FileReader();
    fr.onload=async ev=>{
        const b64=String(ev.target.result).split(',')[1];
        let res,raw;
        try{
            res=await fetch('https://vision.googleapis.com/v1/images:annotate?key='+encodeURIComponent(key),{
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({requests:[{image:{content:b64},features:[{type:'DOCUMENT_TEXT_DETECTION'}]}]})
            });
        }catch(err){ alert('🚫 تعذّر الاتصال بـ Vision (شبكة أو منع):\n'+((err&&err.message)||err)); return; }
        try{ raw=await res.text(); }catch(_){ raw=''; }
        let data={}; try{ data=JSON.parse(raw); }catch(_){}
        const errMsg=(data.error&&data.error.message)||(data.responses&&data.responses[0]&&data.responses[0].error&&data.responses[0].error.message);
        if(!res.ok||errMsg){ alert('🚫 خطأ Vision (HTTP '+res.status+'):\n'+(errMsg||raw||'بلا تفاصيل')); return; }
        const text=(data.responses&&data.responses[0]&&data.responses[0].fullTextAnnotation&&data.responses[0].fullTextAnnotation.text)||'';
        if(!text){ alert('Vision لم يُرجِع أي نص — جرّب صورة أوضح وأقرب.'); return; }
        const bars=_parseBars(text);
        if(!bars.length){ alert('قرأ Vision النصّ التالي لكن لم أجد أزواج عيار/وزن:\n\n'+text); return; }
        _showBarsReview(bars);
    };
    fr.readAsDataURL(file);
};
/* العيار = عدد صحيح 500–999، الوزن = رقم عشري؛ يُقرنان بأي ترتيب */
function _parseBars(text){
    const raw=String(text);
    /* ورقة تحليل XRF: فيها Au + وزن بجانبه g → سبيكة واحدة بقيم دقيقة */
    if(/\bAu\b/i.test(raw) && /(Poids|\d+(?:[.,]\d+)?\s*g\b)/i.test(raw)){
        const xb=_parseXrf(raw);
        if(xb.length) return xb;
    }
    /* ملصقات برتقالية: العيار صحيح 500–999، الوزن عشري، يُقرنان بأي ترتيب */
    const toks=(raw.replace(/,/g,'.').match(/\d+(?:\.\d+)?/g)||[]);
    const bars=[]; let cur={k:0,w:0};
    const push=()=>{ if(cur.k||cur.w){bars.push(cur);cur={k:0,w:0};} };
    for(const t of toks){
        const n=parseFloat(t);
        const isKarat=(t.indexOf('.')<0 && n>=500 && n<=999);
        if(isKarat){ if(cur.k) push(); cur.k=n; }
        else { if(cur.w) push(); cur.w=n; }
        if(cur.k&&cur.w) push();
    }
    push();
    return bars.filter(b=>b.w>0);
}
/* ورقة/أوراق تحليل: لكل Au عياره، ويُقرن بأقرب وزن (Poids/g) — يدعم عدّة أوراق */
function _parseXrf(raw){
    const s=String(raw).replace(/,/g,'.');
    /* مواضع كل العيارات: "Au <رقم>" */
    const karats=[]; let m;
    const reAu=/\bAu\b[^0-9]{0,6}(\d{3}(?:\.\d+)?)/gi;
    while((m=reAu.exec(s))!==null){ karats.push({pos:m.index, k:Math.round(parseFloat(m[1]))}); }
    /* مواضع كل الأوزان: "Poids : <رقم>" أو "<رقم> g" */
    const weights=[];
    const reP=/Poids[^0-9]{0,6}(\d+(?:\.\d+)?)/gi;
    while((m=reP.exec(s))!==null){ weights.push({pos:m.index, w:parseFloat(m[1])}); }
    if(!weights.length){
        const reG=/(\d+(?:\.\d+)?)\s*g\b/gi;
        while((m=reG.exec(s))!==null){ weights.push({pos:m.index, w:parseFloat(m[1])}); }
    }
    /* لكل عيار: اقرن بأقرب وزن يأتي بعده (وإلا أقرب وزن مطلقاً) */
    const usedW=new Set(); const bars=[];
    for(const ka of karats){
        let best=-1,bestD=Infinity;
        for(let i=0;i<weights.length;i++){
            if(usedW.has(i))continue;
            const after=weights[i].pos>=ka.pos;
            const d=(after?0:1e9)+Math.abs(weights[i].pos-ka.pos);
            if(d<bestD){bestD=d;best=i;}
        }
        const w=best>=0?weights[best].w:0; if(best>=0)usedW.add(best);
        if(ka.k>0||w>0)bars.push({k:ka.k||0,w:w||0});
    }
    /* لو لم نجد أي Au لكن وُجدت أوزان فقط */
    if(!bars.length){ for(const wt of weights){ if(wt.w>0)bars.push({k:0,w:wt.w}); } }
    return bars;
}
function _showBarsReview(bars){
    let m=document.getElementById('barsReviewModal');
    if(!m){ m=document.createElement('div'); m.id='barsReviewModal'; m.className='modal-overlay'; document.body.appendChild(m); }
    const rows=bars.map((b,i)=>`
        <div class="brRow" style="display:flex;gap:.4rem;align-items:center;margin-bottom:.4rem">
            <span style="color:var(--t2);font-size:.8rem;width:1.3rem">${i+1}</span>
            <input id="brK_${i}" value="${b.k||''}" inputmode="numeric" placeholder="العيار" style="flex:1;padding:.5rem;border:1.5px solid var(--border);border-radius:8px;text-align:center;background:var(--card);color:var(--t);font-family:inherit">
            <input id="brW_${i}" value="${b.w||''}" inputmode="decimal" placeholder="الوزن" style="flex:1;padding:.5rem;border:1.5px solid var(--border);border-radius:8px;text-align:center;background:var(--card);color:var(--t);font-family:inherit">
            <button onclick="this.closest('.brRow').remove()" style="background:transparent;border:none;color:#dc2626;font-size:1.1rem;cursor:pointer">🗑</button>
        </div>`).join('');
    m.innerHTML=`<div class="modal-box" style="max-width:430px">
        <div class="modal-header"><h3 style="font-size:.95rem">📷 مراجعة السبائك (${bars.length})</h3><button class="close-btn" onclick="closeModal('barsReviewModal')">✕</button></div>
        <div style="padding:.9rem">
            <div style="font-size:.72rem;color:var(--t2);text-align:center;margin-bottom:.6rem">راجع الأرقام وعدّلها ثم أدرجها في الفاتورة</div>
            <div style="display:flex;gap:.4rem;margin-bottom:.3rem;font-size:.7rem;color:var(--t3)"><span style="width:1.3rem"></span><span style="flex:1;text-align:center">العيار</span><span style="flex:1;text-align:center">الوزن (غ)</span><span style="width:1.3rem"></span></div>
            <div id="barsReviewList" style="max-height:48vh;overflow-y:auto">${rows}</div>
            <button onclick="confirmBarsReview(${bars.length})" style="width:100%;margin-top:.6rem;padding:.65rem;border:none;border-radius:10px;background:#16a34a;color:#fff;font-weight:800;font-size:.9rem;font-family:inherit;cursor:pointer">✅ إدراج في الفاتورة</button>
        </div></div>`;
    m.classList.add('active');
}
window.confirmBarsReview=(n)=>{
    const out=[];
    for(let i=0;i<n;i++){
        const ke=document.getElementById('brK_'+i), we=document.getElementById('brW_'+i);
        if(!ke||!we)continue;
        const k=parseFloat(String(ke.value||'').replace(',','.'))||0;
        const w=parseFloat(String(we.value||'').replace(',','.'))||0;
        if(w>0) out.push({k,w});
    }
    if(!out.length){ toast('لا سبائك للإدراج','error'); return; }
    _fillInvFromBars(out);
    closeModal('barsReviewModal');
    toast('✅ أُدرجت '+out.length+' سبيكة','success');
};
function _fillInvFromBars(bars){
    for(const b of bars){
        let target=null;
        for(let i=1;i<=invRows;i++){
            const we=document.getElementById('inv_w_'+i);
            if(we && !(parseInvNum(we.value)>0)){ target=i; break; }
        }
        if(target==null){ addInvRow(true); target=invRows; }
        const we=document.getElementById('inv_w_'+target), ke=document.getElementById('inv_k_'+target);
        if(we) we.value=String(b.w);
        if(ke && b.k>0) ke.value=String(b.k);
        if(typeof calcInvRow==='function') calcInvRow(target);
    }
    if(typeof saveDraft==='function') saveDraft();
}

/* ═══════════ ترباح — ملاحظات حرّة (لا تدخل أي حساب أو رصيد) ═══════════ */
const _tarbahKey=()=>'tarbah_notes_'+(typeof _SITE!=='undefined'&&_SITE?_SITE+'_':'')+(_currentUser||'_');
window._tarbahList=[];
window._loadTarbah=()=>{
    try{ window._tarbahList=JSON.parse(localStorage.getItem(_tarbahKey())||'[]')||[]; }catch(e){ window._tarbahList=[]; }
    if(typeof _renderTarbahList==='function')_renderTarbahList();
};
function _tarbahPersist(){
    try{localStorage.setItem(_tarbahKey(),JSON.stringify(window._tarbahList));}catch(e){}
    if(typeof _scheduleSave==='function')_scheduleSave();   /* مزامنة عبر الأجهزة عبر إعدادات Firebase */
}
window._applyTarbah=(jsonStr)=>{
    try{ const arr=JSON.parse(jsonStr); if(Array.isArray(arr)){ window._tarbahList=arr; try{localStorage.setItem(_tarbahKey(),jsonStr);}catch(e){} _renderTarbahList(); } }catch(e){}
};
let _tbType='buy';
window._setTbType=(t)=>{
    _tbType=t;
    const b=document.getElementById('tbBuyBtn'), s=document.getElementById('tbSellBtn');
    if(!b||!s)return;
    const base='flex:1;padding:.5rem;border-radius:8px;font-weight:800;font-size:.85rem;cursor:pointer;font-family:inherit;border:1.5px solid;';
    b.style.cssText=base+(t==='buy'?'background:#16a34a;color:#fff;border-color:#16a34a':'background:transparent;color:#16a34a;border-color:#16a34a');
    s.style.cssText=base+(t==='sell'?'background:#dc2626;color:#fff;border-color:#dc2626':'background:transparent;color:#dc2626;border-color:#dc2626');
};
function _ensureTarbahModal(){
    if(document.getElementById('tarbahModal'))return;
    const div=document.createElement('div');
    div.id='tarbahModal'; div.className='modal-overlay';
    div.onclick=(e)=>{ if(e.target===div) closeModal('tarbahModal'); };  /* ضغط الخلفية يُغلق */
    div.innerHTML=`
    <div class="modal-box" style="max-width:420px">
        <div class="modal-header">
            <h3 style="font-size:.95rem">📒 ترباح — ملاحظات</h3>
            <button class="close-btn" onclick="closeModal('tarbahModal')">✕</button>
        </div>
        <div style="padding:.9rem;display:flex;flex-direction:column;gap:.7rem">
            <div style="font-size:.72rem;color:var(--t2);text-align:center">ملاحظات حرّة فقط — لا تدخل في أي حساب أو رصيد</div>
            <div style="display:flex;gap:.4rem">
                <button id="tbBuyBtn" onclick="_setTbType('buy')">🟢 شراء</button>
                <button id="tbSellBtn" onclick="_setTbType('sell')">🔴 بيع</button>
            </div>
            <input id="tbName" type="text" placeholder="الاسم" autocomplete="off" style="padding:.6rem;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:.9rem;box-sizing:border-box;background:var(--card);color:var(--t)">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem">
                <input id="tbWeight" type="text" inputmode="decimal" placeholder="الميزان (غ)" style="padding:.6rem;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:.9rem;box-sizing:border-box;text-align:center;background:var(--card);color:var(--t)">
                <input id="tbPrice" type="text" inputmode="decimal" placeholder="السعر" style="padding:.6rem;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:.9rem;box-sizing:border-box;text-align:center;background:var(--card);color:var(--t)">
            </div>
            <button onclick="addTarbah()" style="width:100%;padding:.6rem;border:none;border-radius:10px;background:#7c3aed;color:#fff;font-weight:800;font-size:.9rem;font-family:inherit;cursor:pointer">➕ إضافة</button>
            <div id="tarbahList" style="display:flex;flex-direction:column;gap:.4rem;max-height:42vh;overflow-y:auto"></div>
        </div>
    </div>`;
    document.body.appendChild(div);
}
window.openTarbah=()=>{
    _ensureTarbahModal();
    _setTbType('buy');
    _renderTarbahList();
    document.getElementById('tarbahModal').classList.add('active');
    setTimeout(()=>document.getElementById('tbName')?.focus(),300);
};
window.addTarbah=()=>{
    const g=id=>(document.getElementById(id).value||'').trim();
    const name=g('tbName'),weight=g('tbWeight'),price=g('tbPrice');
    if(!name&&!weight&&!price){ toast('اكتب شيئاً أولاً','error'); return; }
    window._tarbahList.unshift({id:'tb'+Date.now()+Math.random().toString(36).slice(2,6),type:_tbType,name,weight,price});
    _tarbahPersist(); _renderTarbahList();
    ['tbName','tbWeight','tbPrice'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('tbName').focus();
};
window.delTarbah=(id)=>{
    window._tarbahList=(window._tarbahList||[]).filter(x=>x.id!==id);
    _tarbahPersist(); _renderTarbahList();
};
function _renderTarbahList(){
    const box=document.getElementById('tarbahList'); if(!box)return;
    const L=window._tarbahList||[];
    if(!L.length){ box.innerHTML='<div style="text-align:center;color:var(--t2);font-size:.8rem;padding:1rem">لا ملاحظات بعد</div>'; return; }
    const num=v=>{ const n=parseFloat(String(v||'').replace(/\s/g,'').replace(',','.')); return isFinite(n)?n:0; };
    let totW=0, wpSum=0, wSum=0, pSum=0, pCount=0;
    L.forEach(x=>{ const w=num(x.weight), p=num(x.price);
        if(w>0) totW+=w;
        if(w>0&&p>0){ wpSum+=w*p; wSum+=w; }
        if(p>0){ pSum+=p; pCount++; }
    });
    const avg = wSum>0 ? wpSum/wSum : (pCount>0 ? pSum/pCount : 0);
    const summary=`<div style="position:sticky;top:0;z-index:1;display:flex;justify-content:space-around;gap:.5rem;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:.55rem;margin-bottom:.2rem">
        <div style="text-align:center;color:var(--t)"><div style="color:var(--t2);font-size:.68rem">مجموع الميزان</div><strong style="font-size:.9rem">${fmt(totW,2)} غ</strong></div>
        <div style="text-align:center;color:var(--t)"><div style="color:var(--t2);font-size:.68rem">متوسط السعر</div><strong style="font-size:.9rem">${avg>0?fmt(avg,0):'—'}</strong></div>
    </div>`;
    const items=L.map(x=>{
        const badge=x.type==='sell'
            ?'<span style="color:#dc2626;font-weight:800">بيع</span> · '
            :x.type==='buy'?'<span style="color:#16a34a;font-weight:800">شراء</span> · ':'';
        return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:.55rem .7rem">
            <div style="font-size:.85rem;line-height:1.5;color:var(--t)">
                ${badge}<strong style="color:var(--t)">${x.name||'—'}</strong>${x.weight?` · ⚖️ ${x.weight}`:''}${x.price?` · 💵 ${x.price}`:''}
            </div>
            <button onclick="delTarbah('${x.id}')" style="background:transparent;border:none;color:#dc2626;font-size:1.05rem;cursor:pointer;padding:.2rem">🗑</button>
        </div>`;
    }).join('');
    box.innerHTML=summary+items;
}
window._renderTarbahList=_renderTarbahList;
function _restoreDubaiCalcInputs(){
    try{
        const raw=localStorage.getItem(_dcKey());
        if(!raw)return false;
        const v=JSON.parse(raw);
        if(v.disc    !==undefined) document.getElementById('dcDisc').value    =v.disc;
        if(v.ship    !==undefined) document.getElementById('dcShip').value    =v.ship;
        if(v.dollar  !==undefined) document.getElementById('dcDollar').value  =v.dollar;
        if(v.expenses!==undefined) document.getElementById('dcExpenses').value=v.expenses;
        return !!(v.disc||v.ship||v.dollar||v.expenses);
    }catch(e){return false;}
}
window.openDubaiCalc=()=>{
    /* استعادة القيم المحفوظة */
    const hadSaved=_restoreDubaiCalcInputs();
    /* إذا لم تكن قيمة للدولار محفوظة، نأخذها من الإعدادات */
    const dEl=document.getElementById('dcDollar');
    if(!dEl.value) dEl.value=dollarRate;
    /* ربط الحفظ التلقائي عند كل تغيير (مرة واحدة فقط لكل حقل) */
    ['dcDisc','dcShip','dcDollar','dcExpenses'].forEach(id=>{
        const el=document.getElementById(id);
        if(el&&!el._dcSave){el._dcSave=true;el.addEventListener('input',_saveDubaiCalcInputs);}
    });
    /* احفظ فوراً (تشمل قيمة الدولار المُعبَّأة برمجياً) */
    _saveDubaiCalcInputs();
    document.getElementById('dubaiCalcModal').classList.add('active');
    autoCalcDubai();
};
/* تحديث تلقائي عند تغيّر السعر اللحظي إذا كانت النافذة مفتوحة وبها قيم */
function autoCalcDubai(){
    /* حدّث حقل السعر في نموذج دبي إذا كان مفتوحاً */
    const dubaiMod=document.getElementById('dubaiModal');
    if(dubaiMod&&dubaiMod.classList.contains('active')&&liveSpotPrice>0){
        const prEl=document.getElementById('dubaiPrice');
        if(prEl&&!prEl._userEdited) prEl.value=liveSpotPrice;
    }
    const modal=document.getElementById('dubaiCalcModal');
    if(!modal||!modal.classList.contains('active'))return;
    const disc=document.getElementById('dcDisc').value;
    if(!disc)return; /* لا تحسب بدون قيم */
    calcDubaiSell();
}
window.calcDubaiSell=()=>{
    const spot    =liveSpotPrice;
    const disc    =parseFloat(document.getElementById('dcDisc').value)||0;
    const ship    =parseFloat(document.getElementById('dcShip').value)||0;
    const dollar  =parseFloat(document.getElementById('dcDollar').value)||dollarRate;
    const expenses=parseFloat(document.getElementById('dcExpenses').value)||0;
    const res=document.getElementById('dcResult');
    if(!spot){
        res.textContent='⚠️ سعر الشاشة اللحظي غير متاح بعد';
        res.style.color='var(--rd)';
        return;
    }
    /* المعادلة: ((سعر الشاشة - الخصم) × 32.15 - الشحن) ÷ 100 × الدولار × 0.73 - المصاريف */
    const result=((spot-disc)*32.15 - ship)/100*dollar*0.73 - expenses;
    /* تقريب النتيجة للألف الأعلى وحذف الكسر */
    const rounded=Math.ceil(result/1000)*1000;
    const fmt=v=>v.toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:0});
    res.innerHTML=`<span style="font-size:.72rem;color:var(--t2)">سعر الشاشة: ${spot.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} $/أوقية</span><br>
        <span style="font-size:1.4rem;color:var(--gr);font-weight:900">${fmt(rounded)}</span>`;
    /* تحديث الشارة في الهيدر */
    const _dsr=document.getElementById('dubaiSellResult'); if(_dsr)_dsr.textContent=fmt(rounded);
};

/* يحسب سعر بيع دبي تلقائياً من القيم المحفوظة + السعر اللحظي، دون فتح الحاسبة */
window._refreshDubaiSell=()=>{
    const el=document.getElementById('dubaiSellResult');
    if(!el||!liveSpotPrice)return;
    let disc=0,ship=0,dollar=dollarRate,expenses=0;
    try{
        const raw=localStorage.getItem(_dcKey());
        if(raw){const v=JSON.parse(raw);
            disc=parseFloat(v.disc)||0; ship=parseFloat(v.ship)||0;
            dollar=parseFloat(v.dollar)||dollarRate; expenses=parseFloat(v.expenses)||0;}
    }catch(e){}
    const result=((liveSpotPrice-disc)*32.15 - ship)/100*dollar*0.73 - expenses;
    const rounded=Math.ceil(result/1000)*1000;
    el.textContent=rounded.toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:0});
};

window.saveDubai=()=>{
    const o=document.getElementById('dubaiOffice').value.trim();
    const w=parseFloat(document.getElementById('dubaiWeight').value);
    const sp=parseFloat(document.getElementById('dubaiPrice').value);
    const disc=parseFloat(document.getElementById('dubaiDisc').value)||0;
    if(!o||isNaN(w)||w<=0||isNaN(sp)||sp<=0)return toast('تأكد من البيانات','error');
    const usd=Math.max(0,(sp-disc)*w/31.1035);
    const _cur24=getCustBal(o,'ذهب 24');
    const fromDebt=Math.min(w,Math.max(0,_cur24));
    const fromInv=w-fromDebt;
    let barsRemove=[],barUpdates=[];
    if(fromInv>0.001){
        if(B['ذهب 24']<fromInv-0.001)return toast('⚠️ مخزون 24 أو دين المكتب غير كافٍ','error');
        const r=_pickBarsToRemove('24',fromInv);
        barsRemove=r.barsRemove;barUpdates=r.barUpdates;
    }
    const did='DUB-'+uid();
    const dt=new Date().toLocaleDateString('fr-FR');
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    /* سعر الصرف = آخر «بيع دولار» (لا الشراء) — dollInvoices الأحدث أولاً */
    const _sellRate=(dollInvoices.find(x=>x&&x.isBuy===false&&Number(x.r)>0)||{}).r||dollarRate;
    const _dub={id:did,c:o,w,sp,disc,usd,dt,rate:_sellRate};
    emitEvent('DUBAI',
        {o,w,sp,disc,usd,rate:_sellRate,fromDebt,fromInv,barsRemove,barUpdates},
        {dubaiInvoice:_dub,op:{c:o,t:'بيع دبي',m:'دولار',a:usd,_ts:Date.now(),dt:nowStr,sentW:w,sp,disc,did,rate:_sellRate}}
    );
    window._editRestore=null;
    closeModal('dubaiModal');
    toast('🏙️ تم ترحيل عملية دبي');
    /* تنزيل تلقائي مُلغى — اعرض من الأرشيف 👁 */
};
['dubaiWeight','dubaiPrice','dubaiDisc'].forEach(id=>{
    document.getElementById(id).addEventListener('input',()=>{
        /* إذا عدّل المستخدم السعر يدوياً — لا نعيد الكتابة فوقه */
        if(id==='dubaiPrice') document.getElementById('dubaiPrice')._userEdited=true;
        const w=parseFloat(document.getElementById('dubaiWeight').value)||0;
        const sp=parseFloat(document.getElementById('dubaiPrice').value)||0;
        const disc=parseFloat(document.getElementById('dubaiDisc').value)||0;
        document.getElementById('dubaiTotal').textContent='💰 '+fmt(Math.max(0,(sp-disc)*w/31.1035),2)+' USD';
    });
});

/* ═══ تفاصيل العملية (helper مشترك بين السجل والفاتورة) ═══ */
function opDetailLines(o,custView){
    const f=(n,d=2)=>(n||0).toLocaleString('fr-FR',{maximumFractionDigits:d});
    const lines=[];
    const t=o.t||'';
    if(t==='شراء سلعة'||t==='بيع سلعة'){
        const isBuy=t==='شراء سلعة';
        const inv=(typeof dollInvoices!=='undefined'?dollInvoices:[]).find(x=>x.id===o.did);
        if(!inv||!Array.isArray(inv.items)){
            /* لا فاتورة مفصّلة — سطر واحد موجز فقط إن كان فيه قيمة */
            if(Math.abs(o.a||0)>0.001)lines.push(`⚖️ صافي المكافئ (705): ${f(o.a||0,2)} غ${o.fee?` · 💰 الأجرة: ${f(o.fee,0)} دج`:''}`);
        }else{
            /* 🎯 اعرض فقط الأقسام التي فيها قيمة فعلية — لا سطور صفرية */
            const realItems=inv.items.filter(it=>(it.w||0)>0.001);
            realItems.forEach(it=>{
                const fv=it.fv!=null?it.fv:((it.w||0)*(it.p||0));
                lines.push(`${it.n==='روتور'?'♻️':'🛍️'} ${it.n} — ${f(it.w,2)}غ عيار ${f(it.k,0)}${it.p?` × ${f(it.p,0)} دج/غ = ${f(fv,0)} دج`:''}`);
            });
            if(inv.rot&&(inv.rot.w||0)>0.001)lines.push(`♻️ روتور (مرتجع): ${f(inv.rot.w,2)}غ عيار ${f(inv.rot.k,0)}${inv.rot.p?` × ${f(inv.rot.p,0)} دج/غ = ${f(inv.rot.fv||0,0)} دج`:''}`);
            if(inv.kass&&inv.kass.eq>0.001)lines.push(`⚱️ ${isBuy?'دفع':'أخذ'} لاكاص: ${inv.kass.items.map(it=>f(it.w,2)+'غ/'+f(it.k,0)).join(' + ')} = ${f(inv.kass.eq,2)} غ (705)`);
            if(inv.cash>0.001)lines.push(`💵 ${isBuy?'أخذ':'دفع'} دينار: ${f(inv.cash,0)} دج (${isBuy?'خرج من':'دخل إلى'} السيولة)`);
            if(inv.cashiCash&&(inv.cashiCash.amt||0)>0.001)lines.push(`💵 كاصي بالدينار: ${f(inv.cashiCash.amt,0)} دج ÷ ${f(inv.cashiCash.rate,0)} = ${f(inv.cashiCash.eq,2)} غ (705)`);
            if(inv.cashiFee&&inv.cashiFee.items&&(inv.cashiFee.din||0)>0.001)lines.push(`⚱️ أجرة بالكاصي: ${inv.cashiFee.items.map(it=>f(it.w,2)+'غ/'+f(it.k,0)+'×'+f(it.p,0)).join(' + ')} = ${f(inv.cashiFee.din,0)} دج`);
            /* سطر المكافئ الإجمالي: فقط إن كان فيه ذهب فعلي (لا في عملية دينار صرفة) */
            const _nEq=(inv.a||0)-(inv.rot?inv.rot.eq||0:0)-(inv.kass?inv.kass.eq||0:0);
            const _nFee=(inv.fee||0)-(inv.rot?inv.rot.fv||0:0);
            if(Math.abs(_nEq)>0.001){
                lines.push(`⚖️ صافي المكافئ (705): ${f(_nEq,2)} غ${_nFee?` · 💰 الأجرة: ${f(_nFee,0)} دج`:''}`);
            }
        }
    } else if(t==='قبض دينار'||t==='دفع دينار'){
        const inv=(typeof dollInvoices!=='undefined'?dollInvoices:[]).find(x=>x.id===o.did);
        const amt=inv?((inv.cash||0)+((inv.cashiCash&&inv.cashiCash.amt)||0)):(o.a||0);
        lines.push(`💵 ${t==='قبض دينار'?'قبضت منه':'دفعت له'}: ${f(amt,0)} دج`);
    } else if((t==='شراء'||t==='بيع')&&o.iid){
        const inv=(typeof invoices!=='undefined'?invoices:[]).find(i=>i.id===o.iid);
        if(inv&&inv.items){
            inv.items.forEach(b=>{
                lines.push(`• عيار ${b.k||'?'} — ${f(b.w,2)}غ × ${f(b.ppg||b.p||0,0)} دج/غ = ${f(b.total||b.tot||0,0)} دج`);
            });
            lines.push(`📋 ${inv.ps==='full'?'💵 نقداً':'🔖 دين'} | الإجمالي: ${f(inv.tp,0)} دج`);
            if(inv.akhd) lines.push(`✅ المقبوض: ${f(inv.akhd,0)} دج`);
        }
    } else if(t==='شحن'){
        if(o.sp) lines.push(`💲 السعر: ${o.sp} $/100غ`);
        if(o.rc) lines.push(`📦 المستلم: ${f(o.rc,2)} غ`);
    } else if(t==='رافيناج'){
        if(o.sentW) lines.push(`⚖️ المرسل: ${f(o.sentW,2)} غ 730`);
        if(o.rec24!=null) lines.push(`✨ المستلم: ${f(o.rec24,2)} غ 24 خالص`);
        if(o.fee) lines.push(`💸 الأجرة: ${f(o.fee,0)} دج`);
    }
    if(o.paper) lines.push('📒 قيد دفتري (بدون مخزون)');
    if(o.bars730&&o.bars730.length){
        o.bars730.forEach((b,i)=>lines.push(`🔸 سبيكة ${i+1}: ${f(b.w,2)} غ · عيار ${b.k}`));
    }
    if(o.realW&&o.realK) lines.push(`⚖️ الحقيقي: ${f(o.realW,2)} غ عيار ${o.realK}`);
    if(o.xferTo){
        const _xa=(amt,ty)=>ty==='دينار'?`${f(amt,0)} دج`:ty==='دولار'?`${f(amt,2)} غ سلعة`:`${f(amt,3)} غ ${ty}`;
        lines.push(`🔁 تحويل إلى: ${o.xferTo}`);
        lines.push(`📦 المبلغ: ${_xa(o.a,o.m)}`+((o.xferDstType&&o.xferDstType!==o.m)?` ← ${_xa(o.xferWDst||0,o.xferDstType)}`:''));
    }
    if(o.xferFrom){
        const _xa=(amt,ty)=>ty==='دينار'?`${f(amt,0)} دج`:ty==='دولار'?`${f(amt,2)} غ سلعة`:`${f(amt,3)} غ ${ty}`;
        lines.push(`🔁 تحويل وارد من: ${o.xferFrom}`);
        lines.push(`📥 المبلغ: ${_xa(o.a,o.m)}`);
    }
    if(o.crossKarat)      lines.push(`🔄 تسوية 730 بـ24 — دُفع: ${f(o.paid24||0,3)} غ ذهب 24`);
    if(o.fromInv)         lines.push(`📦 تسوية فيزيائية من مخزون الـ24`);
    if(o.receivePhysical) lines.push(`📥 استلام فيزيائي — ${f(o.actualW||0,3)} غ عيار ${o.actualK||730}`);
    if(o.partial)         lines.push(`⚡ تصفية جزئية — الباقي في الديون`);
    if(o.note) lines.push(`📝 ${o.note}`);
    return lines;
}

/* ═══════════ LOG ═══════════ */
window.showShipLog=()=>{
    const ships=(ops||[]).filter(o=>o.t==='شحن').slice().sort((a,b)=>(b._ts||0)-(a._ts||0));
    const totW=ships.reduce((s,o)=>s+(Number(o.a)||0),0);
    const totRc=ships.reduce((s,o)=>s+(Number(o.rc)||0),0);
    const totCost=ships.reduce((s,o)=>s+((Number(o.rc)||0)*(Number(o.sp)||0)),0);
    let m=document.getElementById('shipLogModal');
    if(!m){m=document.createElement('div');m.id='shipLogModal';m.className='modal-overlay';document.body.appendChild(m);}
    const rows=ships.length?ships.map(o=>{
        const w=Number(o.a)||0, rc=Number(o.rc)||0, p=Number(o.sp)||0, cost=rc*p;
        return `
        <div style="padding:.55rem .2rem;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <div style="font-weight:800;font-size:.84rem">🏢 ${(o.c||'—')}</div>
                <div style="font-size:.68rem;color:var(--t3)">${o.dt||''}</div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--t2);margin-top:.25rem">
                <span>مشحون: <strong>${fmt(w,2)} غ</strong></span>
                <span>استلم (خالص): <strong style="color:#16a34a">${fmt(rc,2)} غ</strong></span>
            </div>
            ${p?`<div style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--t3);margin-top:.2rem">
                <span>السعر: ${fmt(p,2)}</span>
                <span>التكلفة: ${fmt(cost,2)} $</span>
            </div>`:''}
        </div>`;
    }).join(''):'<div style="text-align:center;padding:2rem;color:var(--t3)">لا توجد عمليات شحن</div>';
    m.innerHTML=`<div class="modal-box" style="max-width:460px">
        <div class="modal-header"><h3 style="font-size:.95rem">🚢 سجل الشحن</h3><button class="close-btn" onclick="closeModal('shipLogModal')">✕</button></div>
        <div style="padding:.9rem">
          <div class="infobox" style="margin-bottom:.6rem;font-size:.74rem">عدد الشحنات: <strong>${ships.length}</strong> · مشحون: <strong>${fmt(totW,2)} غ</strong> · استلم: <strong style="color:#16a34a">${fmt(totRc,2)} غ</strong>${totCost?` · تكلفة: <strong>${fmt(totCost,2)} $</strong>`:''}</div>
          <div style="max-height:55vh;overflow-y:auto">${rows}</div>
        </div></div>`;
    m.classList.add('active');
};

/* ═══════════ LOG (الرئيسي) ═══════════ */
function renderLog(){
    const s=(document.getElementById('logSearch')?.value||'').toLowerCase();
    const f=document.getElementById('logFilter')?.value||'all';
    let fl=ops;
    if(s)fl=fl.filter(o=>(o.c||'').toLowerCase().includes(s));
    if(f!=='all')fl=fl.filter(o=>o.t===f);
    const list=document.getElementById('logList');
    if(!fl.length){list.innerHTML='<div style="text-align:center;padding:2.5rem;color:var(--t3)"><i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:.5rem"></i>لا توجد عمليات</div>';return}
    const outTypes=new Set(['أعطيت','بيع','بيع دولار','شحن','مصاريف','سلف','دولار صادر','دفع دينار']);
    const colors={'سلف':'#f97316','رافيناج':'#ea580c','مصاريف':'#dc2626','شحن':'#8b5cf6','بيع دبي':'#14b8a6'};
    list.innerHTML=fl.map(o=>{
        const out=outTypes.has(o.t);
        const bg=colors[o.t]||(out?'var(--rd)':'var(--gr)');
        const unit=o.m==='دينار'?'DZD':'g';
        const dlines=opDetailLines(o);
        const detailHtml=dlines.length
            ?dlines.map(l=>`<br><span style="color:var(--t2);font-size:.6rem;line-height:1.6">${l}</span>`).join('')
            :'';
        return`<div class="log-item" style="align-items:flex-start">
            <div class="log-avatar" style="background:${bg};margin-top:.15rem">${(o.c||'?').substring(0,2)}</div>
            <span style="flex:1;min-width:0">
                <strong style="font-size:.68rem">${o.c||''}</strong>
                <br><small style="color:var(--t2)">${o.dt||''} · <span style="color:${bg};font-weight:700">${_tName(o.t)}</span></small>${detailHtml}
            </span>
            <span style="color:${out?'var(--rd)':'var(--gr)'};font-weight:900;font-size:.7rem;white-space:nowrap;margin-top:.1rem">
                ${out?'−':'+'}${fmt(o.a||0,2)} ${unit}
            </span>
            <button class="btndel" onclick="delOp('${o.id}')" style="margin-top:.1rem"><i class="fas fa-trash-alt"></i></button>
        </div>`;
    }).join('');
    /* علامة مائية باسم المستخدم خلف السجل */
    const _wmEl=document.getElementById('logWm');
    if(_wmEl){
        const u=((typeof _currentUser!=='undefined'&&_currentUser)?_currentUser:(localStorage.getItem('gp12_user')||sessionStorage.getItem('gp12_user')||'')).toString();
        const row=u?(u+' • ').repeat(4):'';
        const ln=`<div style="transform:rotate(-26deg);white-space:nowrap;font-size:40px;font-weight:900;color:#d4af37;opacity:.06;letter-spacing:2px;margin:26px 0">${row}</div>`;
        _wmEl.innerHTML=u?ln+ln+ln+ln:'';
    }
}
/* ═══ إرسال سجل زبون ═══ */
window.openSendLog=()=>{
    document.getElementById('sendLogCustomer').value='';
    document.getElementById('sendLogPreview').textContent='';
    document.getElementById('sendLogPeriod').value='all';
    document.getElementById('sendLogModal').classList.add('active');
    setTimeout(()=>document.getElementById('sendLogCustomer').focus(),350);
};
window.previewSendLog=()=>{
    const c=document.getElementById('sendLogCustomer').value.trim();
    const days=document.getElementById('sendLogPeriod').value;
    if(!c){document.getElementById('sendLogPreview').textContent='';return;}
    const cutoff=days==='all'?0:Date.now()-days*86400000;
    const custOps=ops.filter(o=>{
        if((o.c||'').toLowerCase()!==c.toLowerCase())return false;
        if(o.t==='شحن')return false; /* الشحن له سجلّ مستقلّ */
        if(cutoff>0){
            /* نحاول تحليل التاريخ من dt */
            return true; /* نُظهر الكل ونفلتر بالعرض */
        }
        return true;
    });
    document.getElementById('sendLogPreview').textContent=
        custOps.length?`✅ ${custOps.length} معاملة للزبون "${c}"`:`⚠️ لا توجد معاملات للزبون "${c}"`;
};
window.sendCustomerLog=()=>{
    const c=document.getElementById('sendLogCustomer').value.trim();
    if(!c)return toast('اختر زبوناً أولاً','error');
    const custOps=ops.filter(o=>(o.c||'').toLowerCase()===c.toLowerCase()&&o.t!=='شحن');
    if(!custOps.length)return toast('لا توجد معاملات لهذا الزبون','error');

    const outTypes=new Set(['أعطيت','بيع','بيع دولار','شحن','مصاريف','سلف','دولار صادر','دفع دينار']);
    const typeColors={'أعطيت':'#ef4444','استلمت':'#22c55e','شراء':'#3b82f6','بيع':'#ef4444',
        'سلف':'#f97316','رافيناج':'#ea580c','مصاريف':'#dc2626','شحن':'#8b5cf6','تحويل لزبون':'#7c3aed'};
    const user=document.getElementById('currentUserDisplay').textContent||'';
    const now=new Date().toLocaleDateString('ar-DZ',{year:'numeric',month:'long',day:'numeric'});

    const rows=custOps.map((o,i)=>{
        const out=outTypes.has(o.t);
        const unit=o.m==='دينار'?'DZD':'g';
        const clr=typeColors[o.t]||(out?'#ef4444':'#22c55e');
        const dlines=opDetailLines(o);
        const detailCell=dlines.length
            ?`<td style="font-size:.72rem;color:#555;line-height:1.8">${dlines.map(l=>`<span style="display:block">${l}</span>`).join('')}</td>`
            :'<td style="color:#ccc">—</td>';
        return`<tr style="background:${i%2?'#f9f7f0':'#fff'}">
            <td style="color:#999;font-size:.75rem">${custOps.length-i}</td>
            <td style="font-size:.78rem">${o.dt||''}</td>
            <td><span style="background:${clr};color:#fff;padding:.1rem .45rem;border-radius:4px;font-size:.72rem;white-space:nowrap">${_tName(o.t)}</span></td>
            <td style="font-size:.78rem">${_tDisp(o.m||'')}</td>
            <td style="font-weight:700;color:${clr};white-space:nowrap">${out?'−':'+'}${(o.a||0).toLocaleString('fr-FR',{maximumFractionDigits:2})} ${unit}</td>
            ${detailCell}
        </tr>`;
    }).join('');

    /* الرصيد الصافي الحقيقي من جدول الديون */
    const _metals=['دينار','دولار','ذهب 730','ذهب 24'];
    const _units={دينار:'DZD',دولار:'غ','ذهب 730':'g','ذهب 24':'g'};
    const _custDebts=_metals.map(m=>({m,v:getCustBal(c,m)})).filter(x=>Math.abs(x.v)>0.001);
    const netBalHtml=_custDebts.length?`
<h2 style="border-color:#b8860b;color:#b8860b">💰 الرصيد الصافي الحالي</h2>
<div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1.2rem">
${_custDebts.map(({m,v})=>{
    const owed=v>0;
    const unit=_units[m];
    const lbl=owed?'يَدين لنا':'نَدين له';
    const clr=owed?'#16a34a':'#dc2626';
    const bg=owed?'#f0fdf4':'#fef2f2';
    const border=owed?'#86efac':'#fca5a5';
    return`<div style="flex:1;min-width:140px;background:${bg};border:2px solid ${border};border-radius:8px;padding:.6rem .8rem;text-align:center">
        <div style="font-size:.72rem;color:#666;margin-bottom:.2rem">${_tDisp(m)}</div>
        <div style="font-size:1.25rem;font-weight:900;color:${clr}">${Math.abs(v).toLocaleString('fr-FR',{maximumFractionDigits:2})} ${unit}</div>
        <div style="font-size:.7rem;font-weight:700;color:${clr};margin-top:.15rem">${lbl}</div>
    </div>`;
}).join('')}
</div>`
:`<div style="background:#f9f7f0;border:1px dashed #c8b87a;border-radius:6px;padding:.7rem;text-align:center;color:#888;font-size:.82rem;margin-bottom:1rem">✅ لا توجد أرصدة مستحقة — الحساب صافٍ</div>`;

    const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>سجل معاملات — ${c}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#fff;color:#111;padding:1.2cm;font-size:13px}
h1{color:#b8860b;font-size:1.5rem;text-align:center;margin-bottom:.2rem}
.sub{text-align:center;color:#777;font-size:.78rem;margin-bottom:1rem}
h2{font-size:.95rem;color:#555;margin:1rem 0 .35rem;border-bottom:2px solid #e5e0d0;padding-bottom:.25rem}
table{width:100%;border-collapse:collapse;margin-bottom:1rem;font-size:.8rem}
th{background:#b8860b;color:#fff;padding:.4rem .5rem;text-align:right}
td{padding:.35rem .5rem;border-bottom:1px solid #f0ece0;vertical-align:top}
.detail-line{display:block;color:#555;font-size:.72rem;line-height:1.8}
.footer{text-align:center;color:#aaa;font-size:.7rem;margin-top:1.5rem;border-top:1px solid #eee;padding-top:.5rem}
@media print{body{padding:.8cm}th{-webkit-print-color-adjust:exact;print-color-adjust:exact}div{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<h1>🥇 GoldPro</h1>
<div class="sub">سجل معاملات الزبون: <strong>${c}</strong> | طُبع بتاريخ ${now} | المستخدم: ${user}</div>

<h2>📋 تفاصيل المعاملات (${custOps.length})</h2>
<table><thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>العملة</th><th>المبلغ</th><th>التفاصيل</th></tr></thead>
<tbody>${rows}</tbody></table>

${netBalHtml}

<div class="footer">GoldPro — وثيقة خاصة بالزبون ${c} | ${now}</div>
<script>window.onload=()=>window.print()<\/script>
</body></html>`;

    const w2=window.open('','_blank','width=900,height=750');
    if(w2){w2.document.write(html);w2.document.close();closeModal('sendLogModal');}
    else toast('فعّل النوافذ المنبثقة لطباعة السجل','error');
};

/* ═══ 👁 عرض سجل الزبون داخل التطبيق (بلا نوافذ منبثقة ولا طباعة) ═══ */
/* 📋 عرض سجل زبون مباشرة (من بطاقة الزبون) — منظور الأدمين، بلا نافذة إرسال */
window.viewCustomerLogDirect=(c)=>{
    if(!c)return;
    const custOps=ops.filter(o=>(o.c||'').toLowerCase()===c.toLowerCase()&&o.t!=='شحن');
    if(!custOps.length)return toast('لا توجد معاملات لهذا الزبون','info');
    let html='';
    try{ html=buildCustomerLogHtml(c,custOps,false); }catch(e){ return toast('تعذّر بناء السجل','error'); }
    const ov=document.getElementById('logViewOverlay');
    const fr=document.getElementById('logViewFrame');
    if(!ov||!fr)return toast('العارض غير متاح','error');
    document.getElementById('logViewTitle').textContent='📋 سجل '+c;
    fr.srcdoc=html;
    ov.style.display='flex';
};
window.viewCustomerLog=()=>{
    const c=document.getElementById('sendLogCustomer').value.trim();
    if(!c)return toast('اختر زبوناً أولاً','error');
    let custOps=ops.filter(o=>(o.c||'').toLowerCase()===c.toLowerCase()&&o.t!=='شحن');
    /* احترام فلتر الفترة */
    const days=document.getElementById('sendLogPeriod')?.value||'all';
    if(days!=='all'){
        const cut=Date.now()-parseInt(days,10)*86400000;
        custOps=custOps.filter(o=>(o._ts||0)>=cut);
    }
    if(!custOps.length)return toast('لا توجد معاملات لهذا الزبون','error');
    let html='';
    try{ html=buildCustomerLogHtml(c,custOps,false); }catch(e){ return toast('تعذّر بناء السجل','error'); } /* false = منظور الأدمين */
    const ov=document.getElementById('logViewOverlay');
    const fr=document.getElementById('logViewFrame');
    if(!ov||!fr)return toast('العارض غير متاح','error');
    document.getElementById('logViewTitle').textContent='📋 سجل '+c;
    fr.srcdoc=html;
    ov.style.display='flex';
    closeModal('sendLogModal');
};
window.closeLogView=()=>{
    const ov=document.getElementById('logViewOverlay');
    if(ov)ov.style.display='none';
    const fr=document.getElementById('logViewFrame');
    if(fr)fr.srcdoc='';
};
window.printLogView=()=>{
    const fr=document.getElementById('logViewFrame');
    try{ fr.contentWindow.focus(); fr.contentWindow.print(); }catch(e){ toast('تعذّرت الطباعة','error'); }
};

/* ═══ واتساب — PDF عبر Web Share API (جوال) أو نافذة طباعة (كمبيوتر) ═══ */
/* ══ بناء HTML سجل الزبون — يُستخدَم مع html2pdf مثل الفاتورة تماماً ══ */
function buildCustomerLogHtml(c,custOps,custView){
    /* custView=true → السجل بمنظور الزبون (معكوس) · false/غياب → منظور المحل (الأدمين) */
    const f=(n,d=2)=>(n||0).toLocaleString('fr-FR',{maximumFractionDigits:d});
    const now=new Date().toLocaleDateString('ar-DZ',{year:'numeric',month:'long',day:'numeric'});
    const user=document.getElementById('currentUserDisplay')?.textContent||'';
    const outTypes=new Set(['أعطيت','بيع','بيع دولار','شحن','مصاريف','سلف','دولار صادر','دفع دينار']);
    const tColor={'أعطيت':'#dc2626','استلمت':'#16a34a','شراء':'#2563eb','بيع':'#dc2626',
        'سلف':'#ea580c','رافيناج':'#92400e','مصاريف':'#dc2626','شحن':'#7c3aed','بيع دبي':'#0d9488',
        'بيع دولار':'#dc2626','شراء دولار':'#2563eb','تحويل لزبون':'#7c3aed','تحويل وارد':'#16a34a','دولار وارد':'#16a34a','دولار صادر':'#dc2626'};

    /* 🔄 عكس أسماء العمليات من منظور الزبون */
    const _flipName=(t)=>({
        'شراء سلعة':'بعت سلعة للمحل','بيع سلعة':'اشتريت سلعة من المحل',
        'قبض دينار':'دفعت للمحل','دفع دينار':'قبضت من المحل',
        'شراء':'بعت للمحل','بيع':'اشتريت من المحل',
        'أعطيت':'استلمت من المحل','استلمت':'سلّمت للمحل',
        'تسليم':'استلمت من المحل','استلام':'سلّمت للمحل',
        'دولار صادر':'سلعة استلمتها','دولار وارد':'سلعة سلّمتها',
        'بيع دولار':'اشتريت سلعة من المحل','شراء دولار':'بعت سلعة للمحل',
        'سلف':'سلفة','رافيناج':'رافيناج','تصفية':'تصفية','مصاريف':'مصاريف','شحن':'شحن'
    }[t]||_tName(t)||t||'');
    const _nameOf=(t)=>custView?_flipName(t):(_tName(t)||t||'—');

    /* أرصدة الزبون */
    const _modes=['دينار','دولار','ذهب 730','ذهب 24'];
    const _units={دينار:'DZD',دولار:'غ','ذهب 730':'g','ذهب 24':'g'};
    const balances=_modes.map(m=>({m,v:getCustBal(c,m)})).filter(x=>Math.abs(x.v)>0.001);

    const balHtml=balances.length
        ?balances.map(({m,v0})=>{
            const v=custView?-getCustBal(c,m):getCustBal(c,m); /* الزبون يرى العكس */
            const owed=v>0;
            const bg=owed?'#fef2f2':'#f0fdf4';
            const border=owed?'#fca5a5':'#86efac';
            const col=owed?'#b91c1c':'#15803d';
            /* منظور المحل: يدين لنا/ندين له · منظور الزبون: لك عند المحل/عليك للمحل */
            const lbl=custView?(owed?'لك عند المحل':'عليك للمحل'):(owed?'يدين لنا':'ندين له');
            return`<td style="width:${100/balances.length}%;padding:8px;background:${bg};
                border:2px solid ${border};border-radius:6px;text-align:center;vertical-align:middle">
                <div style="font-size:18px;font-weight:900;color:${col};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f(Math.abs(v),2)} ${_units[m]}</div>
                <div style="font-size:11px;color:#555;margin-top:2px">${_tDisp(m)}</div>
                <div style="font-size:11px;font-weight:700;color:${col}">${lbl}</div>
            </td>`;}).join('')
        :`<td style="text-align:center;color:#6b7280;padding:10px;font-size:13px">
            ✅ لا توجد أرصدة مستحقة — الحساب صافٍ</td>`;

    /* صفوف الجدول */
    const rows=custOps.map((o,i)=>{
        const outRaw=outTypes.has(o.t);
        const out=custView?!outRaw:outRaw;      /* الزبون يرى الاتجاه معكوساً */
        const unit=o.m==='دينار'?'DZD':'g';
        const amtColor=out?'#dc2626':'#16a34a';
        const amtSign=out?'−':'+';
        const tc=tColor[o.t]||'#374151';
        const bg=i%2===0?'#fff':'#fafaf7';
        const dlines=opDetailLines(o,custView);
        const detailHtml=dlines.length
            ?`<div style="margin-top:4px;font-size:10px;color:#555;line-height:1.7;border-top:1px dashed #d1d5db;padding-top:3px">${
                dlines.map(l=>`<span style="display:block">${l}</span>`).join('')}</div>`:'';
        return`<tr style="background:${bg}">
            <td style="padding:7px 5px;text-align:center;color:#9ca3af;font-size:12px;border-bottom:1px solid #e5e7eb">${custOps.length-i}</td>
            <td style="padding:7px 6px;font-size:11px;color:#374151;border-bottom:1px solid #e5e7eb;white-space:nowrap">${o.dt||'—'}</td>
            <td style="padding:7px 6px;font-size:12px;font-weight:700;color:${tc};border-bottom:1px solid #e5e7eb">${_nameOf(o.t)}</td>
            <td style="padding:7px 6px;font-size:13px;font-weight:900;color:${amtColor};border-bottom:1px solid #e5e7eb;white-space:nowrap">${amtSign}${f(o.a,2)} ${unit}</td>
            <td style="padding:7px 6px;font-size:11px;border-bottom:1px solid #e5e7eb">${detailHtml}</td>
        </tr>`;}).join('');

    const _wmRow=user?(user+' • ').repeat(5):'';
    const _wmLine=`<div style="transform:rotate(-26deg);white-space:nowrap;text-align:center;font-size:52px;font-weight:900;color:#b8860b;opacity:.06;letter-spacing:2px;margin:30px 0">${_wmRow}</div>`;
    return`<div style="position:relative;overflow:hidden;padding:14px;font-family:'Tajawal',Arial,sans-serif;direction:rtl;max-width:720px;margin:auto;font-size:13px">
        <!-- علامة مائية (لوقو) باسم المستخدم خلف السجل -->
        <div style="position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden">
            ${user?_wmLine+_wmLine+_wmLine+_wmLine:''}
        </div>
        <div style="position:relative;z-index:1">
        <!-- ترويسة -->
        <div style="background:#b8860b;color:#fff;border-radius:8px 8px 0 0;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:0">
            <span style="font-size:20px;font-weight:900;letter-spacing:1px">GoldPro</span>
            <span style="font-size:14px;font-weight:700">${c}</span>
            <span style="font-size:11px;opacity:.85">${now}</span>
        </div>
        <div style="background:#7a5c00;color:#ffe;padding:4px 16px;font-size:10px;text-align:left;margin-bottom:10px">${user}</div>

        <!-- أرصدة -->
        <div style="margin-bottom:10px">
            <div style="background:#b8860b;color:#fff;padding:5px 10px;font-weight:700;font-size:12px;border-radius:4px 4px 0 0">
                💰 الرصيد الصافي الحالي
            </div>
            <table style="width:100%;border-collapse:separate;border-spacing:4px;background:#f9f6ef;padding:6px;border-radius:0 0 6px 6px">
                <tr>${balHtml}</tr>
            </table>
        </div>

        <!-- جدول المعاملات -->
        <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
                <tr style="background:#374151;color:#fff">
                    <th style="padding:8px 5px;text-align:center;width:28px">#</th>
                    <th style="padding:8px 6px;text-align:right">التاريخ</th>
                    <th style="padding:8px 6px;text-align:right">النوع</th>
                    <th style="padding:8px 6px;text-align:right">المبلغ</th>
                    <th style="padding:8px 6px;text-align:right">التفاصيل</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>

        <!-- تذييل -->
        <div style="margin-top:10px;text-align:center;font-size:10px;color:#9ca3af">
            GoldPro | ${c} | ${now} | ${custOps.length} عملية
        </div>
        </div>
    </div>`;
}
function _logPdfOpts(c){
    const safe=c.replace(/\s+/g,'_');
    return{margin:4,filename:`سجل_${safe}.pdf`,image:{type:'jpeg',quality:.97},
        html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}};
}

window.sendCustomerLogWA=async()=>{
    const c=document.getElementById('sendLogCustomer').value.trim();
    if(!c)return toast('اختر زبوناً أولاً','error');
    const custOps=ops.filter(o=>(o.c||'').toLowerCase()===c.toLowerCase()&&o.t!=='شحن');
    if(!custOps.length)return toast('لا توجد معاملات لهذا الزبون','error');

    toast('⏳ جاري إنشاء PDF...','info');
    const safeC=c.replace(/\s+/g,'_');
    const fname=`سجل_${safeC}.pdf`;
    closeModal('sendLogModal');

    html2pdf().set(_logPdfOpts(c)).from(buildCustomerLogHtml(c,custOps,true)).outputPdf('blob') /* true = منظور الزبون */
        .then(blob=>_showShareCard(blob,fname,`سجل معاملات ${c}`))
        .catch(e=>toast('❌ خطأ في توليد PDF: '+(e&&e.message||e),'error'));
};

window.delOp=(id)=>{
    if(!confirm('حذف هذه العملية وعكس أثرها على الحسابات؟'))return;
    /* السطور المولّدة (تحويل وارد/دولار وارد…) تحمل لاحقة _in/_pty — نُبطل حدثها الأصلي */
    const baseId=String(id).replace(/_(in|pty)$/,'');
    if(baseId!==String(id)&&!confirm('هذا سطر مرآة لعملية أصلية — سيُحذف مع عمليته الأصلية (الطرفان). متابعة؟'))return;
    if(typeof _warnIfConsumedEvt==='function'&&_warnIfConsumedEvt(baseId)){
        if(!confirm('⚠️ سبائك هذه العملية استُهلكت في عمليات لاحقة (بيع/رافيناج/شحن). حذفها قد يترك أثراً غير متسق. هل أنت متأكد؟'))return;
    }
    emitEvent('VOID',{voids:baseId},{});
    toast('↩️ تم حذف العملية وعكس أثرها','info');
};

/* ═══════════ DEBTS ═══════════ */
window._debtFilter=window._debtFilter||'all';
window.setDebtFilter=(f)=>{
    window._debtFilter=f;
    document.querySelectorAll('.debtFilterBtn').forEach(b=>{
        const on=b.getAttribute('data-f')===f;
        const c=b.getAttribute('data-f')==='market'?'#0369a1':b.getAttribute('data-f')==='workshop'?'#c2410c':'var(--g600)';
        b.style.background=on?c:'transparent';
        b.style.color=on?'#fff':c;
    });
    renderDebts();
};
window.renderProfit=()=>{
    const el=document.getElementById('profitContent'); if(!el)return;
    const cap=window._capital||{gold705:0,din:0,ts:0,price:0};
    const bk=_netBuckets();
    const curG=bk.gold705Total||0, curD=bk.cashValue||0;
    const hasCap=Math.abs(cap.gold705)>0.001||Math.abs(cap.din)>0.5;
    if(!hasCap){
        el.innerHTML=`<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:1.2rem;text-align:center">
            <div style="font-size:2rem">💼</div>
            <div style="font-weight:900;margin:.4rem 0">لم تُدخل رأس المال بعد</div>
            <div style="font-size:.78rem;color:var(--t2);line-height:1.7">رأس مالك هو <strong>الأرصدة الافتتاحية</strong> — ما تملكه لحظة البداية.<br>افتحها من ⚙ الإعدادات وأدخل: الدينار + السلعة بالتفصيل + ديون الزبائن.<br>بعدها تُحسب أرباحك تلقائياً هنا.</div>
        </div>`;
        return;
    }
    const pG=Math.round((curG-cap.gold705)*1000)/1000;   /* ربح الذهب بالغرام (705) */
    const pD=Math.round(curD-cap.din);                    /* ربح الدينار */
    const pGval=pG*goldPrice;                             /* ربح الذهب مقوّماً بالسعر الحالي */
    const total=pGval+pD;
    const capValNow=cap.gold705*goldPrice+cap.din;        /* رأس المال بأسعار اليوم */
    const capValThen=cap.price?(cap.gold705*cap.price+cap.din):0;
    const pct=capValNow>0?(total/capValNow*100):0;
    const C=(v)=>v>=0?'var(--gr)':'var(--rd)';
    const S=(v)=>v>0?'+':'';
    const box=(title,rows)=>`<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:.8rem;margin-bottom:.6rem">
        <div style="font-weight:900;font-size:.82rem;color:var(--g500);margin-bottom:.5rem">${title}</div>${rows}</div>`;
    const row=(l,v,c)=>`<div style="display:flex;justify-content:space-between;padding:.25rem 0;font-size:.82rem">
        <span style="color:var(--t2)">${l}</span><strong style="color:${c||'var(--t)'}" dir="ltr">${v}</strong></div>`;

    el.innerHTML=
    /* الربح الكلي */
    `<div style="background:linear-gradient(135deg,${total>=0?'rgba(16,185,129,.15)':'rgba(239,68,68,.15)'},var(--card));border:2px solid ${C(total)};border-radius:16px;padding:1rem;margin-bottom:.7rem;text-align:center">
        <div style="font-size:.75rem;color:var(--t2);font-weight:800">${total>=0?'📈 صافي الربح':'📉 صافي الخسارة'}</div>
        <div style="font-size:1.6rem;font-weight:900;color:${C(total)};margin:.2rem 0" dir="ltr">${S(total)}${fmt(total,0)} دج</div>
        <div style="font-size:.7rem;color:var(--t2)" dir="ltr">${S(pct)}${fmt(pct,1)}% من رأس المال</div>
    </div>`
    +box('💼 رأس المال (من الأرصدة الافتتاحية)',
        row('🥇 ذهب (705)',fmt(cap.gold705,2)+' غ')+
        row('💵 دينار',fmt(cap.din,0)+' دج')+
        (capValThen?row('القيمة وقتها (سعر '+fmt(cap.price,0)+')',fmt(capValThen,0)+' دج','var(--t2)'):'')+
        row('القيمة بسعر اليوم',fmt(capValNow,0)+' دج','var(--g500)')+
        (cap.ts?`<div style="font-size:.62rem;color:var(--t3);text-align:left;margin-top:.3rem">${new Date(cap.ts).toLocaleDateString('fr-FR')}</div>`:''))
    +box('📊 الوضع الحالي',
        row('🥇 ذهب (705)',fmt(curG,2)+' غ')+
        row('💵 دينار',fmt(curD,0)+' دج')+
        row('القيمة الإجمالية',fmtDin(bk.goldValue+bk.cashValue)+' دج','var(--g500)'))
    +box('📈 الربح الحقيقي (بلا أثر تقلّب السعر)',
        row('🥇 ربح الذهب',S(pG)+fmt(pG,2)+' غ (705)',C(pG))+
        row('💵 ربح الدينار',S(pD)+fmt(pD,0)+' دج',C(pD))+
        `<div style="border-top:1px dashed var(--border);margin:.4rem 0"></div>`+
        row('قيمة ربح الذهب اليوم',S(pGval)+fmt(pGval,0)+' دج',C(pGval))+
        row('الصافي بالدينار',S(total)+fmt(total,0)+' دج',C(total)))
    +`<div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.3);border-radius:10px;padding:.6rem;font-size:.68rem;color:var(--t2);line-height:1.6">
        ℹ️ <strong>لماذا الربح مفصول؟</strong> لو ارتفع سعر الذهب فقيمة أصولك ترتفع دون أن تربح غراماً واحداً.
        <strong>ربح الذهب بالغرام</strong> هو ربحك الحقيقي من التجارة، وقيمته بالدينار تتغيّر مع السعر.
    </div>`;
};
function renderDebts(){
    const tb=document.getElementById('debtsBody');
    const tf=document.getElementById('debtsFoot');
    if(!debts.length){tb.innerHTML='<tr><td colspan="5" style="padding:2rem;color:var(--t3)"><i class="fas fa-check-circle" style="color:var(--gr)"></i> لا توجد ديون</td></tr>';if(tf)tf.innerHTML='';return}
    const cd={};
    debts.forEach(d=>{
        if(!cd[d.c])cd[d.c]={di:0,do:0,g7:0,g2:0};
        cd[d.c][d.type==='دينار'?'di':d.type==='دولار'?'do':d.type==='ذهب 730'?'g7':'g2']+=(d.a||0);
    });
    const kind=window._custKind||{};
    const filter=window._debtFilter||'all';
    /* تصفية حسب التصنيف: السوق (أبيع له) / الورشات (أشتري منه) */
    const entries=Object.entries(cd).filter(([n])=>{
        if(filter==='all')return true;
        return (kind[n]||'market')===filter; /* غير المصنّف يُعامل كسوق افتراضياً */
    });
    const lastTx={};
    ops.forEach(o=>{ if(o&&o.c){ const t=o._ts||0; if(t>(lastTx[o.c]||0)) lastTx[o.c]=t; } });
    const fD=(v,d=0,unit='')=>{
        if(!v||Math.abs(v)<0.001)return'—';
        /* الدينار (Da) يُقرّب لأقرب ألف · الذهب يبقى بكسوره */
        const isDin=unit==='Da'||unit==='دج';
        const shown=isDin?fmtDin(v):fmt(v,d);
        return`<span class="${v>0?'debt-pos':'debt-neg'}">${shown}</span>${unit?`<small style="font-size:.65rem;color:var(--t3);margin-right:.15rem"> ${unit}</small>`:''}`;
    };
    if(!entries.length){tb.innerHTML='<tr><td colspan="5" style="padding:2rem;color:var(--t3)">لا توجد ديون في هذا القسم</td></tr>';if(tf)tf.innerHTML='';return;}
    tb.innerHTML=entries
        .sort((a,b)=>{
            const ta=lastTx[a[0]]||0, tb2=lastTx[b[0]]||0;
            if(tb2!==ta) return tb2-ta;
            return Math.abs(b[1].di)-Math.abs(a[1].di);
        })
        .map(([n,v])=>{
            const tag=(kind[n]||'market')==='workshop'?'<span style="font-size:.55rem;background:rgba(194,65,12,.15);color:#c2410c;padding:.05rem .3rem;border-radius:.5rem;margin-right:.2rem">ورشة</span>':'<span style="font-size:.55rem;background:rgba(3,105,161,.15);color:#0369a1;padding:.05rem .3rem;border-radius:.5rem;margin-right:.2rem">سوق</span>';
            return`<tr>
            <td><strong style="cursor:pointer;color:var(--g600);text-decoration:underline;text-decoration-style:dotted" onclick="openGoodsFor('${n.replace(/'/g,"\\'")}')" title="فتح ${(kind[n]||'market')==='workshop'?'شراء':'بيع'} سلعة">${n}</strong> ${filter==='all'?tag:''}</td>
            <td>${fD(v.di,0,'Da')}</td><td>${fD(v.do,2,'غ')}</td>
            <td>${fD(v.g2,2,'غ (24)')}</td>
            <td><button class="btn-settle" onclick="openSettle('${n.replace(/'/g,"\\'")}')">✅ تصفية</button></td>
        </tr>`;}).join('');
    /* الإجمالي */
    const tot=entries.reduce((s,[,v])=>({di:s.di+v.di,do:s.do+v.do,g2:s.g2+v.g2}),{di:0,do:0,g2:0});
    if(tf)tf.innerHTML=`<tr style="border-top:2px solid var(--g600);font-weight:900;background:var(--card2)">
        <td style="font-weight:900">الإجمالي (${entries.length})</td>
        <td>${fD(tot.di,0,'Da')}</td><td>${fD(tot.do,2,'غ')}</td>
        <td>${fD(tot.g2,2,'غ (24)')}</td><td></td>
    </tr>`;
}
window.exportDebtsPdf=function(){
    if(!debts.length){toast('لا توجد ديون للتصدير','info');return;}
    if(typeof html2pdf==='undefined'){toast('مكتبة PDF غير محمّلة — أعد فتح التطبيق','error');return;}

    /* تجميع الديون لكل زبون */
    const cd={};
    debts.forEach(d=>{
        if(!cd[d.c])cd[d.c]={di:0,do:0,g2:0};
        if(d.type==='دينار')cd[d.c].di+=(d.a||0);
        else if(d.type==='دولار')cd[d.c].do+=(d.a||0);
        else if(d.type==='ذهب 24')cd[d.c].g2+=(d.a||0);
        else if(d.type==='ذهب 730')cd[d.c].do+=(d.a||0)*(730/705); /* قديم → 705 */
    });
    const rows=Object.entries(cd).filter(([,v])=>Math.abs(v.di)>0.001||Math.abs(v.do)>0.001||Math.abs(v.g2)>0.001)
        .sort((a,b)=>Math.abs(b[1].di)-Math.abs(a[1].di));

    /* مجاميع الأعمدة */
    const tot={di:0,do:0,g2:0};
    rows.forEach(([,v])=>{tot.di+=v.di;tot.do+=v.do;tot.g2+=v.g2;});

    /* الفائدة الشهرية (قيمة الأصول + شحن دبي) — نفس منطق showMonthlyProfit */
    const assets=net();
    let dubW=0; const _offs=new Set();
    (typeof dubaiInvoices!=='undefined'?dubaiInvoices:[]).forEach(i=>{ if(i.o)_offs.add(i.o); if(i.c)_offs.add(i.c); });
    debts.forEach(d=>{ if(d.type==='ذهب 24'&&d.a>0.001&&_offs.has(d.c))dubW+=d.a; });
    const _shipSp=(typeof _lastShipSp==='function')?_lastShipSp():0;
    const _buyR=(dollarBuyRate>0?dollarBuyRate:dollarRate)||0;
    const shipDubai=Math.round(dubW*_shipSp*_buyR/100);
    const monthlyProfit=Math.round(assets)+shipDubai;

    /* ذهب البيع المتبقي (الكاصي) وسعره */
    const tr=window._cashiTracker||{buyW:0,buyDin:0,soldW:0,soldDin:0};
    const netW=Math.round((tr.buyW-tr.soldW)*1000)/1000;
    const netDin=Math.round(tr.buyDin-tr.soldDin);
    let cashiLabel,cashiVal,cashiPrice;
    if(Math.abs(netW)<0.001){ cashiLabel='لا يوجد كاصي معلّق'; cashiVal='—'; cashiPrice=''; }
    else if(netW>0){ cashiLabel='🛒 لاكاص تشتريه'; cashiVal=fmt(netW,2)+' غ'; cashiPrice=fmt(Math.round(netDin/netW),0)+' دج/غ'; }
    else { cashiLabel='🏷️ لاكاص تبيعه'; cashiVal=fmt(Math.abs(netW),2)+' غ'; cashiPrice=fmt(Math.round(Math.abs(netDin)/Math.abs(netW)),0)+' دج/غ'; }

    const f0=n=>Math.round(n||0).toLocaleString('fr-FR');
    const fV=(v,d=0)=>{
        if(!v||Math.abs(v)<0.001)return'<span style="color:#bbb">—</span>';
        const col=v>0?'#16a34a':'#dc2626';
        return`<span style="color:${col};font-weight:700">${v>0?'+':'−'}${fmt(Math.abs(v),d)}</span>`;
    };
    const dt=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});
    const shopName=(document.getElementById('currentUserDisplay')?.textContent)||'';

    /* بطاقة مجموع */
    const card=(icon,label,value,sub,color)=>`
        <div style="flex:1;min-width:120px;background:#fff;border:1.5px solid ${color};border-radius:10px;padding:8px 6px;text-align:center">
            <div style="font-size:15px">${icon}</div>
            <div style="font-size:9px;color:#666;margin:2px 0">${label}</div>
            <div style="font-size:14px;font-weight:900;color:${color}">${value}</div>
            ${sub?`<div style="font-size:8.5px;color:#888;margin-top:1px">${sub}</div>`:''}
        </div>`;

    const html=`
    <div style="padding:14px;font-family:Tajawal,sans-serif;direction:rtl;max-width:640px;margin:auto;color:#1a1a1a">
        <div style="text-align:center;border-bottom:2px solid #1a1a1a;padding-bottom:9px;margin-bottom:11px">
            <div style="font-size:20px;font-weight:900">📒 دفتر الديون${shopName?' — '+shopName:''}</div>
            <div style="font-size:11px;color:#666;margin-top:3px">بتاريخ: ${dt} — عدد الزبائن: ${rows.length}</div>
        </div>

        <!-- بطاقات المجاميع -->
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
            ${card('💵','مجموع الدينار',fmtDin(tot.di)+' دج','','#0369a1')}
            ${card('🥇','مجموع ذهب 705',fmt(tot.do,2)+' غ','','#b45309')}
            ${card('💎','مجموع ذهب 24',fmt(tot.g2,2)+' غ','','#7c3aed')}
        </div>

        <!-- الفائدة الشهرية + ذهب البيع -->
        <div style="display:flex;gap:6px;margin-bottom:11px;flex-wrap:wrap">
            ${card('📈','الفائدة الشهرية',f0(monthlyProfit)+' دج','قيمة الأصول + شحن دبي','#16a34a')}
            ${card(netW>=0?'🛒':'🏷️',cashiLabel,cashiVal,cashiPrice?('السعر: '+cashiPrice):'','#d97706')}
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
                <tr style="background:#1a1a1a;color:#fff;text-align:center">
                    <th style="padding:7px;border:1px solid #555">الزبون</th>
                    <th style="padding:7px;border:1px solid #555">💵 دينار</th>
                    <th style="padding:7px;border:1px solid #555">🥇 ذهب 705 (غ)</th>
                    <th style="padding:7px;border:1px solid #555">💎 ذهب 24 (غ)</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(([n,v],i)=>`
                <tr style="text-align:center;background:${i%2===0?'#fff':'#f7f7f7'}">
                    <td style="border:1px solid #ccc;padding:6px;font-weight:800;text-align:right">${n}</td>
                    <td style="border:1px solid #ccc;padding:6px">${fV(v.di,0)}</td>
                    <td style="border:1px solid #ccc;padding:6px">${fV(v.do,2)}</td>
                    <td style="border:1px solid #ccc;padding:6px">${fV(v.g2,2)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
                <tr style="background:#f0e6c8;font-weight:900;text-align:center">
                    <td style="border:1.5px solid #999;padding:7px;text-align:right">الإجمالي</td>
                    <td style="border:1.5px solid #999;padding:7px">${fV(tot.di,0)}</td>
                    <td style="border:1.5px solid #999;padding:7px">${fV(tot.do,2)}</td>
                    <td style="border:1.5px solid #999;padding:7px">${fV(tot.g2,2)}</td>
                </tr>
            </tfoot>
        </table>
        <div style="margin-top:9px;font-size:9.5px;color:#888;text-align:center">
            إيجابي (أخضر) = يسالك · سالب (أحمر) = تسالو &nbsp;|&nbsp; سعر الذهب: ${f0(goldPrice)} دج/غ
        </div>
    </div>`;

    toast('📄 جاري توليد الملف...','info');
    const opts={margin:6,filename:`ديون_${dt}.pdf`,image:{type:'jpeg',quality:.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}};
    html2pdf().set(opts).from(html).save()
        .then(()=>toast('✅ تم تنزيل دفتر الديون','success'))
        .catch(e=>toast('❌ تعذّر توليد PDF','error'));
};

let _settleCustomer='';
window.openSettle=(name)=>{
    _settleCustomer=name;
    document.getElementById('settleCustomerName').textContent=name;
    _renderSettleRows();
    document.getElementById('settleModal').classList.add('active');
};
function _renderSettleRows(){
    const rows=document.getElementById('settleRows');
    const cd={دينار:0,دولار:0,'ذهب 730':0,'ذهب 24':0};
    debts.filter(d=>d.c===_settleCustomer).forEach(d=>{cd[d.type]=(cd[d.type]||0)+(d.a||0)});
    const icons={دينار:'💵',دولار:'🥇','ذهب 730':'👑','ذهب 24':'💎'};
    const units={دينار:'دج',دولار:'غ','ذهب 730':'غ','ذهب 24':'غ'};
    const decs={دينار:0,دولار:2,'ذهب 730':2,'ذهب 24':2};
    const active=Object.entries(cd).filter(([,v])=>Math.abs(v)>0.001);
    const buyGoldBox=((typeof _usersCache!=='undefined'&&_usersCache[_currentUser]&&_usersCache[_currentUser].isAdmin)?`
    <div style="margin-top:.7rem;padding-top:.7rem;border-top:1px dashed var(--border);display:flex;gap:.4rem">
        <button class="btn-settle" style="flex:1;background:rgba(100,116,139,.12);color:#475569;border-color:#94a3b8" onclick="_adminRenameCust('${_settleCustomer.replace(/'/g,"\\'")}')">✏️ إعادة تسمية</button>
    </div>`:'');
    if(!active.length){rows.innerHTML='<div style="text-align:center;padding:1rem;color:var(--t3)">لا توجد أرصدة للتصفية</div>'+buyGoldBox;return}
    rows.innerHTML=active.map(([type,val])=>{
        const cls=val>0?'debt-pos':'debt-neg';
        /* موجب = تسالو (هو مدين لك) ، سالب = يسالك (أنت مدين له) */
        const dir=val>0?'تسالو':'يسالك';
        const isGold=type==='ذهب 730'||type==='ذهب 24';
        const btnLabel=isGold?(val<0?'🛒 شراء':'💰 بيع'):'صفّي';
        /* أزرار التسوية الإضافية للذهب */
        const extraBtn=type==='ذهب 730'
            ?`<button class="btn-settle" style="background:rgba(217,119,6,.12);color:#d97706;border-color:#d97706;font-size:.72rem;padding:.3rem .5rem" onclick="settle730With24()">🔄 بـ24</button>`
             +(val>0?`<button class="btn-settle" style="background:rgba(16,185,129,.12);color:#059669;border-color:#059669;font-size:.72rem;padding:.3rem .5rem" onclick="receiveSettle730()">📥 استلام</button>`:'')
            :type==='ذهب 24'
            ?`<button class="btn-settle" style="background:rgba(59,130,246,.1);color:#3b82f6;border-color:#3b82f6;font-size:.72rem;padding:.3rem .5rem" onclick="settle24FromInv()">📦 مخزون</button>`
            :'';
        const xferBtn=`<button class="btn-settle" style="background:rgba(139,92,246,.12);color:#7c3aed;border-color:#7c3aed;font-size:.72rem;padding:.3rem .5rem" onclick="openXfer('${type}')">🔁 تحويل لزبون</button>`;
        return`<div class="settle-row">
            <div>
                <div class="sr-info">${icons[type]} ${_tDisp(type)} — <span style="font-size:.7rem;color:var(--t2)">${dir}</span></div>
                <div class="sr-val ${cls}">${fmt(Math.abs(val),decs[type])} ${units[type]}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:.3rem;align-items:flex-end">
                <button class="btn-settle" onclick="settleOne('${type}')">${btnLabel}</button>
                ${extraBtn}
                ${xferBtn}
            </div>
        </div>`;
    }).join('')+buyGoldBox;
}

/* ═══════════ تحويل رصيد ذهب لحساب زبون آخر (لا يمسّ المخزون) ═══════════ */
let _xferSrcType=null,_xferSrcBal=0,_xferMode='same';
window.openXfer=(srcType)=>{
    const bal=debts.filter(x=>x.c===_settleCustomer&&x.type===srcType).reduce((s,x)=>s+(x.a||0),0);
    if(Math.abs(bal)<0.001){toast('لا يوجد رصيد لهذا النوع','info');return;}
    _xferSrcType=srcType; _xferSrcBal=bal; _xferMode='same';
    _ensureXferModal();
    const isGold=srcType==='ذهب 730'||srcType==='ذهب 24';
    const unit=srcType==='دينار'?'دج':'غ';
    const dec=srcType==='دينار'?0:srcType==='دولار'?2:3;
    const dir=bal>0?'تسالو (مدين لك)':'يسالك (أنت مدين له)';
    document.getElementById('xferFrom').textContent=_settleCustomer;
    document.getElementById('xferSrcInfo').textContent=`${srcType} — ${fmt(Math.abs(bal),dec)} ${unit} · ${dir}`;
    document.getElementById('xferTarget').value='';
    document.getElementById('xferW').value=(Math.round(Math.abs(bal)*1000)/1000).toString().replace('.',',');
    document.getElementById('xferWLabel').textContent=`المبلغ المحوّل (${unit})`;
    /* خيار التحويل بين العيارين للذهب فقط */
    const modeRow=document.getElementById('xferModeRow');
    if(isGold){
        modeRow.style.display='flex';
        const other=srcType==='ذهب 730'?'ذهب 24':'ذهب 730';
        document.getElementById('xferModeSame').textContent=`كما هي (${srcType})`;
        document.getElementById('xferModeConv').textContent=`حوّل لـ${other}`;
        _setXferMode('same');
    }else{
        modeRow.style.display='none';
        _xferMode='same';
        _xferCalc();
    }
    document.getElementById('xferModal').classList.add('active');
    if(window._acAttach)_acAttach('xferTarget');
    setTimeout(()=>document.getElementById('xferTarget').focus(),320);
};
window._setXferMode=(m)=>{
    _xferMode=m;
    const a=document.getElementById('xferModeSame'),b=document.getElementById('xferModeConv');
    const base='flex:1;padding:.55rem;border:1.5px solid;border-radius:8px;font-size:.78rem;font-weight:700;cursor:pointer;';
    const on='background:#7c3aed;color:#fff;border-color:#7c3aed', off='background:transparent;color:#7c3aed;border-color:#7c3aed';
    a.style.cssText=base+(m==='same'?on:off);
    b.style.cssText=base+(m==='conv'?on:off);
    _xferCalc();
};
function _xferCalc(){
    const isGold=_xferSrcType==='ذهب 730'||_xferSrcType==='ذهب 24';
    const W=readNum('xferW');
    let dstType=_xferSrcType,wDst=W;
    if(isGold&&_xferMode==='conv'){
        if(_xferSrcType==='ذهب 730'){dstType='ذهب 24';wDst=W*730/1000;}
        else{dstType='ذهب 730';wDst=W*1000/730;}
    }
    const dec=dstType==='دينار'?0:dstType==='دولار'?2:3;
    const txt=isGold?`${fmt(wDst,dec)} غ ${dstType}`:`${fmt(wDst,dec)} ${dstType==='دينار'?'دج':'$'}`;
    const el=document.getElementById('xferPreview'); if(!el)return;
    el.innerHTML=`يستلم الزبون الهدف: <strong style="color:#7c3aed">${txt}</strong>`
        +((isGold&&_xferMode==='conv')?`<br><span style="font-size:.7rem;color:var(--t3)">${_xferSrcType==='ذهب 730'?'المكافئ = الكمية × 730 ÷ 1000':'المكافئ = الكمية × 1000 ÷ 730'}</span>`:'');
}
window._xferCalc=_xferCalc;
window.doXfer=()=>{
    const to=(document.getElementById('xferTarget').value||'').trim();
    if(!to){toast('⚠️ اكتب اسم الزبون الهدف','error');return;}
    if(to===_settleCustomer){toast('⚠️ لا يمكن التحويل لنفس الزبون','error');return;}
    const W=readNum('xferW');
    if(!W||W<=0){toast('⚠️ أدخل كمية صحيحة','error');return;}
    const unit=_xferSrcType==='دينار'?'دج':'غ';
    const dec=_xferSrcType==='دينار'?0:_xferSrcType==='دولار'?2:3;
    if(W>Math.abs(_xferSrcBal)+0.001){toast(`⚠️ الكمية أكبر من الرصيد المتاح (${fmt(Math.abs(_xferSrcBal),dec)} ${unit})`,'error');return;}
    const sign=_xferSrcBal>0?1:-1;
    const isGold=_xferSrcType==='ذهب 730'||_xferSrcType==='ذهب 24';
    let dstType=_xferSrcType,wDst=W;
    if(isGold&&_xferMode==='conv'){
        if(_xferSrcType==='ذهب 730'){dstType='ذهب 24';wDst=W*730/1000;}
        else{dstType='ذهب 730';wDst=W*1000/730;}
    }
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    emitEvent('XFER',
        {from:_settleCustomer,to,srcType:_xferSrcType,dstType,srcDelta:sign*W,dstDelta:sign*wDst,w:W,wDst},
        {op:{c:_settleCustomer,t:'تحويل لزبون',m:_xferSrcType,a:W,_ts:Date.now(),dt:nowStr,
             xferTo:to,xferDstType:dstType,xferWDst:wDst,xferSign:sign}}
    );
    closeModal('xferModal');closeModal('settleModal');
    toast(`🔁 حُوّل ${fmt(W,dec)} ${unit} من ${_settleCustomer} إلى ${to}`+((isGold&&_xferMode==='conv')?` (محوّل لـ${dstType})`:''),'success');
};
function _ensureXferModal(){
    if(document.getElementById('xferModal'))return;
    const div=document.createElement('div');
    div.id='xferModal'; div.className='modal-overlay';
    div.innerHTML=`
    <div class="modal-box" style="max-width:340px">
        <div class="modal-header">
            <h3 style="font-size:.9rem">🔁 تحويل رصيد لحساب زبون آخر</h3>
            <button class="close-btn" onclick="closeModal('xferModal')">✕</button>
        </div>
        <div style="padding:1rem;display:flex;flex-direction:column;gap:.7rem">
            <div style="background:var(--card2);border-radius:8px;padding:.7rem;font-size:.82rem;display:flex;flex-direction:column;gap:.3rem">
                <div><span style="color:var(--t2)">من حساب:</span> <strong id="xferFrom"></strong></div>
                <div><span style="color:var(--t2)">الرصيد:</span> <span id="xferSrcInfo" style="font-weight:700"></span></div>
            </div>
            <div>
                <label style="font-size:.78rem;color:var(--t2);display:block;margin-bottom:.3rem">الزبون الهدف</label>
                <input id="xferTarget" type="text" placeholder="اسم الزبون" autocomplete="off"
                    style="width:100%;padding:.65rem;border:1.5px solid var(--border);border-radius:8px;font-size:1rem;font-family:inherit;box-sizing:border-box" />
            </div>
            <div>
                <label id="xferWLabel" style="font-size:.78rem;color:var(--t2);display:block;margin-bottom:.3rem">المبلغ المحوّل (غ)</label>
                <input id="xferW" type="text" inputmode="decimal" dir="ltr" placeholder="0,000"
                    style="width:100%;padding:.65rem;border:1.5px solid var(--border);border-radius:8px;font-size:1rem;font-family:inherit;text-align:right;box-sizing:border-box"
                    oninput="liveNum(this);_xferCalc()" />
            </div>
            <div id="xferModeRow" style="display:flex;gap:.5rem">
                <button id="xferModeSame" onclick="_setXferMode('same')"></button>
                <button id="xferModeConv" onclick="_setXferMode('conv')"></button>
            </div>
            <div id="xferPreview" style="background:rgba(124,58,237,.07);border-radius:8px;padding:.6rem;text-align:center;font-size:.85rem;line-height:1.6"></div>
            <div style="font-size:.72rem;color:var(--t3);text-align:center;line-height:1.5">يُخصم من حساب المصدر ويُضاف لحساب الهدف — دون أي تأثير على المخزون</div>
            <button class="bg" style="width:100%;padding:.7rem;font-size:.93rem" onclick="doXfer()">✅ تأكيد التحويل</button>
        </div>
    </div>`;
    document.body.appendChild(div);
}

/* تصفية نقدية بمبلغ حر: جزئي يُبقي الباقي، وزائد عن الدين يقلب الرصيد باستئذان */
function _cashSettlePrompt(type){
    const net=debts.filter(x=>x.c===_settleCustomer&&x.type===type).reduce((s,x)=>s+(x.a||0),0);
    if(Math.abs(net)<0.001)return false;
    const unit=type==='دولار'?'غ':'دج';
    const v=prompt(`تصفية ${_tDisp(type)} مع ${_settleCustomer}\nالدين الحالي: ${fmt(Math.abs(net),type==='دولار'?2:0)} ${unit} ${net>0?'(يسالك)':'(تسالو)'}\nأدخل المبلغ (افتراضي: كامل الدين):`,String(Math.abs(net)));
    if(v===null)return false;
    const amt=parseFloat(String(v).replace(',','.'));
    if(isNaN(amt)||amt<=0)return toast('مبلغ غير صالح','error'),false;
    if(amt>Math.abs(net)+0.001){
        const over=amt-Math.abs(net);
        if(!confirm(`⚠️ المبلغ أكبر من الدين بـ${fmt(over,type==='دولار'?2:0)} ${unit} — سينقلب الرصيد للاتجاه المعاكس. متابعة؟`))return false;
    }
    if(net<0){ /* أنت الدافع: تحقّق السيولة */
        if(type==='دينار'&&B.دينار<amt-0.001)return toast(`⚠️ رصيد الدينار غير كافٍ (متاح: ${fmt(B.دينار,0)} دج)`,'error'),false;
        if(type==='دولار'&&B.دولار<amt-0.001)return toast('⚠️ رصيد السلعة غير كافٍ','error'),false;
    }
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    emitEvent('SETTLE_CASH',
        {c:_settleCustomer,type,net,amt},
        {op:{c:_settleCustomer,t:'تصفية',m:type,a:net>0?amt:-amt,_ts:Date.now(),dt:nowStr,partial:amt<Math.abs(net)-0.001}}
    );
    return true;
}
function _applySettle(type){
    const net=debts.filter(x=>x.c===_settleCustomer&&x.type===type).reduce((s,x)=>s+(x.a||0),0);
    if(Math.abs(net)<0.001)return false;
    if(type==='دينار'&&net<0&&B.دينار<Math.abs(net)-0.001)
        {toast(`⚠️ رصيد الدينار غير كافٍ للتصفية (متاح: ${fmt(B.دينار,0)} دج)`,'error');return false;}
    if(type==='دولار'&&net<0&&B.دولار<Math.abs(net)-0.001)
        {toast('⚠️ رصيد السلعة غير كافٍ للتصفية','error');return false;}
    if(type==='ذهب 730'&&net>0){const av=g730.reduce((s,b)=>s+(b.w||0),0);if(av<net-0.001){toast(`⚠️ مخزون 730 غير كافٍ للبيع (متاح: ${fmt(av,2)} غ)`,'error');return false;}}
    if(type==='ذهب 24' &&net>0){const av=g24.reduce((s,b)=>s+(b.w||0),0);if(av<net-0.001){toast(`⚠️ مخزون 24 غير كافٍ للبيع (متاح: ${fmt(av,2)} غ)`,'error');return false;}}
    let barsRemove=[],barUpdates=[];
    if(type==='ذهب 730'&&net>0){const r=_pickBarsToRemove('730',net);barsRemove=r.barsRemove;barUpdates=r.barUpdates;}
    if(type==='ذهب 24' &&net>0){const r=_pickBarsToRemove('24',net);barsRemove=r.barsRemove;barUpdates=r.barUpdates;}
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    emitEvent('SETTLE',
        {c:_settleCustomer,type,net,barsRemove,barUpdates},
        {op:{c:_settleCustomer,t:'تصفية',m:type,a:net,_ts:Date.now(),dt:nowStr}}
    );
    return true;
}
window.settleOne=(type)=>{
    if(type==='ذهب 730'||type==='ذهب 24'){_openGoldSettleModal(type);return;}
    if(!_cashSettlePrompt(type))return;
    /* emitEvent داخل _applySettle يستدعي _reproject ← syncBal+updAll+save تلقائياً */
    _renderSettleRows();
    toast(`✅ تم تصفية ${_tDisp(type)} مع ${_settleCustomer}`);
};
window.settleAll=()=>{
    const types=['دينار','دولار','ذهب 730','ذهب 24'];
    let done=0;
    types.forEach(t=>{const ok=_applySettle(t);if(ok)done++;});
    /* emitEvent داخل _applySettle يستدعي _reproject ← syncBal+updAll+save تلقائياً */
    _renderSettleRows();
    if(done)toast(`✅ تم تصفية جميع أرصدة ${_settleCustomer}`);
    else toast('لا توجد أرصدة','info');
};

/* ═══════════ GOLD SETTLE WITH PRICE + INVOICE ═══════════ */
let _gsType='',_gsNet=0,_gsCustomer='',_gsForceBuy=false;

function _ensureGoldSettleModal(){
    if(document.getElementById('goldSettleModal'))return;
    const div=document.createElement('div');
    div.id='goldSettleModal';
    div.className='modal-overlay';
    div.innerHTML=`
    <div class="modal-box" style="max-width:340px">
        <div class="modal-header">
            <h3 id="gsmTitle" style="font-size:.95rem"></h3>
            <button class="close-btn" onclick="closeModal('goldSettleModal')">✕</button>
        </div>
        <div style="padding:1rem;display:flex;flex-direction:column;gap:.75rem">
            <div style="background:var(--card2);border-radius:8px;padding:.6rem;display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:.78rem;color:var(--t2)">إجمالي الدين</span>
                <strong id="gsmQty" style="color:var(--rd);font-size:1rem"></strong>
            </div>
            <div>
                <label style="font-size:.78rem;color:var(--t2);display:block;margin-bottom:.3rem">كمية التصفية (غ)</label>
                <input id="gsmPartialW" type="text" inputmode="decimal" dir="ltr" placeholder="0,000"
                    style="width:100%;padding:.65rem;border:1.5px solid var(--border);border-radius:8px;font-size:1rem;font-family:inherit;text-align:right;box-sizing:border-box"
                    oninput="liveNum(this);_gsmCalc()" />
            </div>
            <div>
                <label style="font-size:.78rem;color:var(--t2);display:block;margin-bottom:.3rem">سعر الغرام (دج)</label>
                <input id="gsmPrice" type="text" inputmode="numeric" dir="ltr" placeholder="مثال: 12 500"
                    style="width:100%;padding:.65rem;border:1.5px solid var(--border);border-radius:8px;font-size:1rem;font-family:inherit;text-align:right;box-sizing:border-box"
                    oninput="liveNum(this);_gsmCalc()" />
            </div>
            <div id="gsmTotalBox" style="display:none;background:var(--card2);border-radius:8px;padding:.6rem;display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:.78rem;color:var(--t2)">المجموع</span>
                <strong id="gsmTotal" style="color:var(--g600);font-size:1rem"></strong>
            </div>
            <button class="bg" style="width:100%;padding:.75rem;font-size:.95rem" onclick="_gsmConfirm()">✅ تأكيد وحفظ الفاتورة</button>
        </div>
    </div>`;
    document.body.appendChild(div);
}

function _openGoldSettleModal(type,forceBuy){
    const net=debts.filter(x=>x.c===_settleCustomer&&x.type===type).reduce((s,x)=>s+(x.a||0),0);
    if(Math.abs(net)<0.001&&!forceBuy){toast('لا توجد أرصدة','info');return;}
    _ensureGoldSettleModal();
    _gsType=type; _gsNet=net; _gsCustomer=_settleCustomer; _gsForceBuy=!!forceBuy;
    const isBuy=forceBuy?true:(net<0);
    const icon=isBuy?'🛒':'💰';
    const action=isBuy?'شراء':'بيع';
    document.getElementById('gsmTitle').textContent=`${icon} ${action} ${_tDisp(type)} — ${_settleCustomer}`;
    document.getElementById('gsmQty').textContent=(forceBuy&&Math.abs(net)<0.001)?'شراء حر':fmt(Math.abs(net),3)+' غ';
    document.getElementById('gsmPartialW').value=(forceBuy&&Math.abs(net)<0.001)?'':Math.abs(net).toString().replace('.',',');
    document.getElementById('gsmPrice').value='';
    document.getElementById('gsmTotalBox').style.display='none';
    document.getElementById('goldSettleModal').classList.add('active');
    setTimeout(()=>document.getElementById('gsmPartialW').focus(),320);
}

window._gsmCalc=function(){
    const ppg=readNum('gsmPrice');
    const w=readNum('gsmPartialW')||0;
    const k=_gsType==='ذهب 24'?1000:730;
    const total=w*(k/730)*ppg;
    const box=document.getElementById('gsmTotalBox');
    if(ppg>0&&w>0){
        box.style.display='flex';
        document.getElementById('gsmTotal').textContent=fmt(total,0)+' دج';
        const net=_gsNet, isBuy=_gsForceBuy?true:(net<0);
        let prev=document.getElementById('gsmDirPreview');
        if(!prev){prev=document.createElement('div');prev.id='gsmDirPreview';prev.style.cssText='font-size:.72rem;line-height:1.7;background:var(--card2);border-radius:8px;padding:.55rem;margin-top:.1rem';box.parentNode.insertBefore(prev,box.nextSibling);}
        let cashTxt,gTxt;
        if(_gsForceBuy){
            cashTxt=`ستدين للزبون بـ <b>${fmt(total,0)} دج</b>`;
            gTxt=`الزبون سيدين لك <b>${fmt(w,3)} غ</b> ذهب`;
        }else{
            const goldNew=net>0?(net-w):(net+w);
            cashTxt=isBuy?`ستدين للزبون بـ <b>${fmt(total,0)} دج</b>`:`الزبون سيدين لك بـ <b>${fmt(total,0)} دج</b>`;
            gTxt=Math.abs(goldNew)<0.001?'رصيد الذهب: صفر':(goldNew>0?`الزبون سيدين لك <b>${fmt(Math.abs(goldNew),3)} غ</b> ذهب`:`ستدين للزبون <b>${fmt(Math.abs(goldNew),3)} غ</b> ذهب`);
        }
        prev.innerHTML=`💵 ${cashTxt}<br>👑 ${gTxt}`;
    }else{
        box.style.display='none';
        const prev=document.getElementById('gsmDirPreview'); if(prev)prev.innerHTML='';
    }
};

window._gsmConfirm=function(){
    const ppg=readNum('gsmPrice');
    if(!ppg||ppg<=0){toast('⚠️ أدخل سعر الغرام','error');return;}
    const w=readNum('gsmPartialW');
    if(!w||w<=0){toast('⚠️ أدخل كمية التصفية','error');return;}
    const type=_gsType, net=_gsNet, c=_gsCustomer;
    if(w<0.001){closeModal('goldSettleModal');return;}
    const isBuy=_gsForceBuy?true:(net<0);
    const k=type==='ذهب 24'?1000:730;
    const eq730=w*(k/730);
    const total=Math.round(eq730*ppg);
    const prevBal=getCustBal(c,'دينار');
    const iid='INV-'+uid();
    const cashTotal=_gsForceBuy?-total:(isBuy?-total:total); /* شراء حر: أنا مدين للزبون بالنقد (−) */
    const settledAmt=isBuy?-w:w;
    const remaining=parseFloat((Math.abs(net)-w).toFixed(4));
    const item={w,k,ppg,eq730,total,is1000:k===1000,sbt:type==='ذهب 24'?'24':'730'};
    const _inv={
        id:iid,c,t:isBuy?'buy':'sell',ps:'debt',
        dt:new Date().toLocaleDateString('fr-FR'),
        items:[item],tp:total,akhd:0,prevBal,
        note:_gsForceBuy?'شراء ذهب من الزبون':(remaining>0.001?`تصفية جزئية (باقٍ ${fmt(remaining,3)} غ)`:'تصفية ديون')
    };
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    emitEvent('SETTLE_GSM',
        {c,type,net,isBuy,cashTotal,remaining,w,k,ppg,iid,freeBuy:_gsForceBuy},
        {invoice:_inv,op:{c,t:_gsForceBuy?'شراء':'تصفية',m:type,a:settledAmt,_ts:Date.now(),dt:nowStr,cashSettle:true,iid,cashTotal,partial:remaining>0.001}}
    );
    closeModal('goldSettleModal');
    _renderSettleRows();
    const msg=remaining>0.001
        ?`✅ تم تصفية ${fmt(w,3)} غ — الباقي: ${fmt(remaining,3)} غ`
        :`✅ تم تصفية ${_tDisp(type)} مع ${c} وحفظ الفاتورة`;
    toast(msg);
    /* تنزيل تلقائي مُلغى */
};

/* ═══════════ تسوية ذهب 730 بـ ذهب 24 (تحويل بالعيار) ═══════════ */
window.settle730With24=function(){
    const net=debts.filter(x=>x.c===_settleCustomer&&x.type==='ذهب 730').reduce((s,x)=>s+(x.a||0),0);
    if(Math.abs(net)<0.001){toast('لا يوجد دين ذهب 730','info');return;}
    const w730=Math.abs(net);
    const avail24=g24.reduce((s,b)=>s+(b.w||0),0);
    _ensureSettle730Modal();
    document.getElementById('s730cName').textContent=_settleCustomer;
    document.getElementById('s730cDir').textContent=net>0?'تسالو':'يسالك';
    document.getElementById('s730cW730').textContent=fmt(w730,3)+' غ';
    document.getElementById('s730cAvail').textContent=fmt(avail24,2)+' غ';
    document.getElementById('s730cPartial').value=w730.toString().replace('.',',');
    _s730cCalcEquiv();
    document.getElementById('s730cModal').classList.add('active');
    setTimeout(()=>document.getElementById('s730cPartial').focus(),320);
};
function _ensureSettle730Modal(){
    if(document.getElementById('s730cModal'))return;
    const div=document.createElement('div');
    div.id='s730cModal';div.className='modal-overlay';
    div.innerHTML=`
    <div class="modal-box" style="max-width:320px">
        <div class="modal-header">
            <h3 style="font-size:.9rem">🔄 تسوية ذهب 730 بـ ذهب 24</h3>
            <button class="close-btn" onclick="closeModal('s730cModal')">✕</button>
        </div>
        <div style="padding:1rem;display:flex;flex-direction:column;gap:.65rem">
            <div style="background:var(--card2);border-radius:8px;padding:.75rem;display:grid;grid-template-columns:auto 1fr;gap:.45rem .9rem;font-size:.82rem;align-items:center">
                <span style="color:var(--t2)">الزبون</span><strong id="s730cName"></strong>
                <span style="color:var(--t2)">الاتجاه</span><span id="s730cDir" style="color:#f59e0b;font-weight:700"></span>
                <span style="color:var(--t2)">إجمالي دين 730</span><strong id="s730cW730" style="color:#ef4444"></strong>
                <span style="color:var(--t2)">متاح بمخزون 24</span><strong id="s730cAvail" style="color:#16a34a"></strong>
            </div>
            <div>
                <label style="font-size:.78rem;color:var(--t2);display:block;margin-bottom:.3rem">كمية التصفية (معيار 730)</label>
                <input id="s730cPartial" type="text" inputmode="decimal" dir="ltr" placeholder="0,000"
                    style="width:100%;padding:.65rem;border:1.5px solid var(--border);border-radius:8px;font-size:1rem;font-family:inherit;text-align:right;box-sizing:border-box"
                    oninput="liveNum(this);_s730cCalcEquiv()" />
            </div>
            <div style="background:var(--card2);border-radius:8px;padding:.6rem;display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:.78rem;color:var(--t2)">مكافئ 24k يُخصم</span>
                <strong id="s730cEquiv" style="color:#d97706;font-size:1rem"></strong>
            </div>
            <div style="font-size:.74rem;color:var(--t3);text-align:center;line-height:1.5;background:rgba(217,119,6,.07);border-radius:6px;padding:.45rem">
                المكافئ = كمية التصفية × (730 ÷ 1000)<br>يُخصم من مخزون الـ24 والباقي يبقى ديناً
            </div>
            <button class="bg" style="width:100%;padding:.7rem;font-size:.93rem" onclick="_confirm730With24()">✅ تأكيد التسوية</button>
        </div>
    </div>`;
    document.body.appendChild(div);
}
window._s730cCalcEquiv=function(){
    const partial=readNum('s730cPartial')||0;
    const eq=parseFloat((partial*730/1000).toFixed(3));
    const el=document.getElementById('s730cEquiv');
    if(el) el.textContent=fmt(eq,3)+' غ';
};
window._confirm730With24=function(){
    const partial=readNum('s730cPartial');
    if(!partial||partial<=0){toast('⚠️ أدخل كمية التصفية','error');return;}
    const net=debts.filter(x=>x.c===_settleCustomer&&x.type==='ذهب 730').reduce((s,x)=>s+(x.a||0),0);
    if(Math.abs(net)<0.001){closeModal('s730cModal');return;}
    if(partial>Math.abs(net)+0.001){toast(`⚠️ الكمية أكبر من الدين (${fmt(Math.abs(net),3)} غ)`,'error');return;}
    const equiv24=parseFloat((partial*730/1000).toFixed(3));
    const avail24=g24.reduce((s,b)=>s+(b.w||0),0);
    if(avail24<equiv24-0.001){toast(`⚠️ مخزون الـ24 غير كافٍ — متاح: ${fmt(avail24,2)} غ — مطلوب: ${fmt(equiv24,3)} غ`,'error');return;}
    const {barsRemove,barUpdates}=_pickBarsToRemove('24',equiv24);
    const remaining=parseFloat((Math.abs(net)-partial).toFixed(4));
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    emitEvent('SETTLE_730_24',
        {c:_settleCustomer,partial,net,equiv24,remaining,barsRemove,barUpdates},
        {op:{c:_settleCustomer,t:'تصفية',m:'ذهب 730',a:net>0?partial:-partial,_ts:Date.now(),dt:nowStr,crossKarat:true,paid24:equiv24,partial:remaining>0.001}}
    );
    closeModal('s730cModal');
    _renderSettleRows();
    const msg=remaining>0.001
        ?`✅ تم: ${fmt(partial,3)} غ 730 ← ${fmt(equiv24,3)} غ 24 — الباقي: ${fmt(remaining,3)} غ`
        :`✅ تم: ${fmt(partial,3)} غ 730 ← ${fmt(equiv24,3)} غ 24 خُصمت من المخزون`;
    toast(msg);
};

/* ═══════════ تسوية ذهب 24 من المخزون مباشرة ═══════════ */
window.settle24FromInv=function(){
    const net=debts.filter(x=>x.c===_settleCustomer&&x.type==='ذهب 24').reduce((s,x)=>s+(x.a||0),0);
    if(Math.abs(net)<0.001){toast('لا يوجد دين ذهب 24','info');return;}
    const w=Math.abs(net);
    const avail24=g24.reduce((s,b)=>s+(b.w||0),0);
    const isGiving=net<0;
    _ensure24InvModal();
    document.getElementById('i24cName').textContent=_settleCustomer;
    document.getElementById('i24cW').textContent=fmt(w,3)+' غ';
    const _d24el=document.getElementById('i24cDir');
    _d24el.textContent=isGiving?'تعطيه ← يخرج من المخزون':'يعطيك ← يدخل المخزون';
    _d24el.style.color=isGiving?'#ef4444':'#16a34a';
    document.getElementById('i24cAvail').textContent=fmt(avail24,2)+' غ';
    document.getElementById('i24cPartial').value=w.toString().replace('.',',');
    document.getElementById('i24cModal').classList.add('active');
    setTimeout(()=>document.getElementById('i24cPartial').focus(),320);
};
function _ensure24InvModal(){
    if(document.getElementById('i24cModal'))return;
    const div=document.createElement('div');
    div.id='i24cModal';div.className='modal-overlay';
    div.innerHTML=`
    <div class="modal-box" style="max-width:320px">
        <div class="modal-header">
            <h3 style="font-size:.9rem">📦 تسوية ذهب 24 من المخزون</h3>
            <button class="close-btn" onclick="closeModal('i24cModal')">✕</button>
        </div>
        <div style="padding:1rem;display:flex;flex-direction:column;gap:.65rem">
            <div style="background:var(--card2);border-radius:8px;padding:.75rem;display:grid;grid-template-columns:auto 1fr;gap:.45rem .9rem;font-size:.82rem;align-items:center">
                <span style="color:var(--t2)">الزبون</span><strong id="i24cName"></strong>
                <span style="color:var(--t2)">إجمالي الدين</span><strong id="i24cW" style="color:#ef4444"></strong>
                <span style="color:var(--t2)">الاتجاه</span><strong id="i24cDir"></strong>
                <span style="color:var(--t2)">مخزون الـ24</span><strong id="i24cAvail" style="color:#16a34a"></strong>
            </div>
            <div>
                <label style="font-size:.78rem;color:var(--t2);display:block;margin-bottom:.3rem">كمية التصفية (غ)</label>
                <input id="i24cPartial" type="text" inputmode="decimal" dir="ltr" placeholder="0,000"
                    style="width:100%;padding:.65rem;border:1.5px solid var(--border);border-radius:8px;font-size:1rem;font-family:inherit;text-align:right;box-sizing:border-box"
                    oninput="liveNum(this)" />
            </div>
            <div style="font-size:.74rem;color:var(--t3);text-align:center;line-height:1.5;background:rgba(59,130,246,.07);border-radius:6px;padding:.45rem">
                تسوية فيزيائية — يُعدَّل مخزون الـ24 والباقي يبقى ديناً
            </div>
            <button class="bg" style="width:100%;padding:.7rem;font-size:.93rem" onclick="_confirm24FromInv()">✅ تأكيد التسوية</button>
        </div>
    </div>`;
    document.body.appendChild(div);
}
window._confirm24FromInv=function(){
    const partial=readNum('i24cPartial');
    if(!partial||partial<=0){toast('⚠️ أدخل كمية التصفية','error');return;}
    const net=debts.filter(x=>x.c===_settleCustomer&&x.type==='ذهب 24').reduce((s,x)=>s+(x.a||0),0);
    if(Math.abs(net)<0.001){closeModal('i24cModal');return;}
    if(partial>Math.abs(net)+0.001){toast(`⚠️ الكمية أكبر من الدين (${fmt(Math.abs(net),3)} غ)`,'error');return;}
    const avail24=g24.reduce((s,b)=>s+(b.w||0),0);
    const isGiving=net<0;
    if(isGiving&&avail24<partial-0.001){toast(`⚠️ مخزون الـ24 غير كافٍ — متاح: ${fmt(avail24,2)} غ`,'error');return;}
    let barsRemove=[],barUpdates=[],barsAdd=[];
    const dt=new Date().toLocaleDateString('fr-FR');
    const dispBars={};
    if(isGiving){
        const r=_pickBarsToRemove('24',partial);
        barsRemove=r.barsRemove;barUpdates=r.barUpdates;
    }else{
        const bid=uid();
        barsAdd=[{id:bid,pool:'24',w:partial,k:1000}];
        dispBars[bid]={desc:`استلام من ${_settleCustomer}`,dt,src:'تصفية'};
    }
    const remaining=parseFloat((Math.abs(net)-partial).toFixed(4));
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    emitEvent('SETTLE_24_INV',
        {c:_settleCustomer,partial,net,remaining,isGiving,barsRemove,barUpdates,barsAdd},
        {bars:Object.keys(dispBars).length?dispBars:undefined,
         op:{c:_settleCustomer,t:'تصفية',m:'ذهب 24',a:net>0?partial:-partial,_ts:Date.now(),dt:nowStr,fromInv:true,partial:remaining>0.001}}
    );
    closeModal('i24cModal');
    _renderSettleRows();
    const msg=remaining>0.001
        ?`✅ تم: ${fmt(partial,3)} غ ${isGiving?'خُصمت':'أُضيفت'} — الباقي: ${fmt(remaining,3)} غ`
        :`✅ تم: ${fmt(partial,3)} غ ذهب 24 ${isGiving?'خُصمت من المخزون':'أُضيفت للمخزون'}`;
    toast(msg);
};

/* ═══════════ استلام ذهب 730 فيزيائي لتسوية الدين ═══════════ */
let _rs730Net=0;
window.receiveSettle730=function(){
    const net=debts.filter(x=>x.c===_settleCustomer&&x.type==='ذهب 730').reduce((s,x)=>s+(x.a||0),0);
    if(net<=0.001){toast('لا يوجد دين ذهب 730 للاستلام','info');return;}
    _rs730Net=net;
    _ensureReceive730Modal();
    document.getElementById('rs730cName').textContent=_settleCustomer;
    document.getElementById('rs730cDebt').textContent=fmt(net,3)+' غ (معيار 730)';
    document.getElementById('rs730Partial').value=net.toString().replace('.',',');
    document.getElementById('rs730Karat').value='730';
    _rs730CalcWeight();
    document.getElementById('rs730Modal').classList.add('active');
    setTimeout(()=>document.getElementById('rs730Partial').focus(),320);
};
function _ensureReceive730Modal(){
    if(document.getElementById('rs730Modal'))return;
    const div=document.createElement('div');
    div.id='rs730Modal';div.className='modal-overlay';
    div.innerHTML=`
    <div class="modal-box" style="max-width:340px">
        <div class="modal-header">
            <h3 style="font-size:.9rem">📥 استلام ذهب 730 (تسوية دين)</h3>
            <button class="close-btn" onclick="closeModal('rs730Modal')">✕</button>
        </div>
        <div style="padding:1rem;display:flex;flex-direction:column;gap:.65rem">
            <div style="background:var(--card2);border-radius:8px;padding:.75rem;display:grid;grid-template-columns:auto 1fr;gap:.45rem .9rem;font-size:.82rem;align-items:center">
                <span style="color:var(--t2)">الزبون</span><strong id="rs730cName"></strong>
                <span style="color:var(--t2)">إجمالي الدين (معيار 730)</span><strong id="rs730cDebt" style="color:#ef4444"></strong>
                <span style="color:var(--t2)">الوزن الفعلي المطلوب</span><strong id="rs730cReqW" style="color:#16a34a"></strong>
            </div>
            <div>
                <label style="font-size:.78rem;color:var(--t2);display:block;margin-bottom:.3rem">كمية التصفية (معيار 730)</label>
                <input id="rs730Partial" type="text" inputmode="decimal" dir="ltr" placeholder="0,000"
                    style="width:100%;padding:.65rem;border:1.5px solid var(--border);border-radius:8px;font-size:1rem;font-family:inherit;text-align:right;box-sizing:border-box"
                    oninput="liveNum(this);_rs730CalcWeight()" />
            </div>
            <div>
                <label style="font-size:.78rem;color:var(--t2);display:block;margin-bottom:.3rem">عيار الذهب المُسلَّم</label>
                <input id="rs730Karat" type="number" inputmode="numeric" value="730" min="100" max="1000"
                    style="width:100%;padding:.65rem;border:1.5px solid var(--border);border-radius:8px;font-size:1rem;font-family:inherit;text-align:center;box-sizing:border-box"
                    oninput="_rs730CalcWeight()" />
            </div>
            <div style="font-size:.74rem;color:var(--t3);text-align:center;line-height:1.5;background:rgba(16,185,129,.07);border-radius:6px;padding:.45rem">
                الوزن = كمية التصفية × 730 ÷ عيار الذهب المُسلَّم<br>يُضاف للمخزون والباقي يبقى ديناً
            </div>
            <button class="bg" style="width:100%;padding:.7rem;font-size:.93rem" onclick="_confirmReceive730()">✅ تأكيد الاستلام</button>
        </div>
    </div>`;
    document.body.appendChild(div);
}
window._rs730CalcWeight=function(){
    const partial=readNum('rs730Partial')||_rs730Net;
    const k=parseFloat(document.getElementById('rs730Karat')?.value)||730;
    const reqW=parseFloat((partial*730/k).toFixed(3));
    const el=document.getElementById('rs730cReqW');
    if(el) el.textContent=fmt(reqW,3)+' غ (عيار '+k+')';
};
window._confirmReceive730=function(){
    const partial=readNum('rs730Partial');
    if(!partial||partial<=0){toast('⚠️ أدخل كمية التصفية','error');return;}
    const k=parseFloat(document.getElementById('rs730Karat').value)||0;
    if(!k||k<100||k>1000){toast('⚠️ عيار غير صالح','error');return;}
    const net=debts.filter(x=>x.c===_settleCustomer&&x.type==='ذهب 730').reduce((s,x)=>s+(x.a||0),0);
    if(net<=0.001){closeModal('rs730Modal');return;}
    if(partial>net+0.001){toast(`⚠️ الكمية أكبر من الدين (${fmt(net,3)} غ)`,'error');return;}
    const reqW=parseFloat((partial*730/k).toFixed(3));
    const bid=uid();
    const barsAdd=[{id:bid,pool:'730',w:reqW,k}];
    const dt=new Date().toLocaleDateString('fr-FR');
    const dispBars={};
    dispBars[bid]={desc:`استلام تصفية من ${_settleCustomer}`,dt,src:'تصفية'};
    const remaining=parseFloat((net-partial).toFixed(4));
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    emitEvent('SETTLE_730_REC',
        {c:_settleCustomer,partial,net,k,reqW,remaining,barsAdd},
        {bars:dispBars,op:{c:_settleCustomer,t:'تصفية',m:'ذهب 730',a:partial,_ts:Date.now(),dt:nowStr,receivePhysical:true,actualW:reqW,actualK:k,partial:remaining>0.001}}
    );
    closeModal('rs730Modal');
    _renderSettleRows();
    const msg=remaining>0.001
        ?`✅ استُلم ${fmt(reqW,3)} غ عيار ${k} — الباقي: ${fmt(remaining,3)} غ معيار 730`
        :`✅ استُلم ${fmt(reqW,3)} غ عيار ${k} من ${_settleCustomer} — أُضيف للمخزون`;
    toast(msg);
    return; /* ─── نهاية الكود الجديد ─── */
};

/* ═══════════ ARCHIVE ═══════════ */
let _archiveFilter='all';
window.setArchiveFilter=(f)=>{ _archiveFilter=f; renderArchive(); };
function _renderArchiveChips(){
    const bar=document.getElementById('archFilterBar'); if(!bar)return;
    const chips=[['all','📋 الكل'],['doll','🛍️ سلعة'],['buy','🟢 شراء'],['sell','🔴 بيع'],['raf','🔥 رافيناج']];
    bar.innerHTML=chips.map(([k,l])=>{
        const on=_archiveFilter===k;
        return `<button onclick="setArchiveFilter('${k}')" style="white-space:nowrap;padding:.35rem .75rem;border-radius:999px;border:1.5px solid var(--g600);font-size:.76rem;font-weight:800;cursor:pointer;font-family:inherit;${on?'background:var(--g600);color:#fff':'background:transparent;color:var(--g600)'}">${l}</button>`;
    }).join('');
}
function renderArchive(){
    const empty='<div style="text-align:center;padding:1.5rem;color:var(--t3);font-size:.8rem"><i class="fas fa-folder-open"></i> لا توجد سجلات</div>';
    _renderArchiveChips();
    const f=_archiveFilter;
    const _sec=(id,vis)=>{const e=document.getElementById(id);if(e)e.style.display=vis?'':'none';};
    _sec('archSec-gold', f==='all'||f==='buy'||f==='sell');
    _sec('archSec-raf',  f==='all'||f==='raf');
    _sec('archSec-doll', f==='all'||f==='doll');
    /* فواتير الشراء/البيع */
    const goldList=f==='buy'?invoices.filter(i=>i.t==='buy'):f==='sell'?invoices.filter(i=>i.t==='sell'):invoices;
    document.getElementById('archiveCount').textContent=goldList.length;
    document.getElementById('archiveList').innerHTML=goldList.length?goldList.map(inv=>`
        <div class="saved-card">
            <div>
                <strong>${inv.c}</strong>
                <span style="color:${inv.t==='buy'?'var(--gr)':'var(--rd)'};font-weight:800;margin-right:.25rem">${inv.t==='buy'?'شراء':'بيع'}</span>
                <span style="color:var(--g600);font-weight:900">${fmt(inv.tp||0,0)} DZD</span>
                <small style="color:var(--t2);display:block">${inv.dt} · ${inv.ps==='full'?'💵 نقداً':'🔖 دين'} · ${(inv.items||[]).length} بند</small>
            </div>
            <div style="display:flex;gap:.3rem">
                <button class="btn-pdf" onclick="editInv('${inv.id}')" style="background:rgba(124,58,237,.12);color:#7c3aed" title="تعديل"><i class="fas fa-pen"></i></button>
                <button class="btn-pdf" onclick="viewDoc('inv','${inv.id}')" title="عرض"><i class="fas fa-eye"></i></button>
                <button class="btn-wa"  onclick="waInv('${inv.id}')"><i class="fab fa-whatsapp"></i></button>
                <button class="btndel" onclick="delInv('${inv.id}')"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>`).join(''):empty;
    /* أرشيف الرافيناج */
    document.getElementById('rafArchiveCount').textContent=rafInvoices.length;
    document.getElementById('rafArchiveList').innerHTML=rafInvoices.length?rafInvoices.map(r=>`
        <div class="saved-card">
            <div>
                <strong>${r.c}</strong>
                <span style="color:#c2410c;font-weight:800;margin-right:.25rem">🔥 رافيناج</span>
                <span style="color:var(--g600);font-weight:900">${fmt(r.sentW||0,2)} غ</span>
                <small style="color:var(--t2);display:block">${r.dt} · ${r.rows.length} قطعة · خالص: ${fmt(r.eq24||0,2)} غ</small>
            </div>
            <div style="display:flex;gap:.3rem">
                <button class="btn-pdf" onclick="editRafInv('${r.id}')" style="background:rgba(124,58,237,.12);color:#7c3aed" title="تعديل"><i class="fas fa-pen"></i></button>
                <button class="btn-pdf" onclick="viewDoc('raf','${r.id}')" title="عرض"><i class="fas fa-eye"></i></button>
                <button class="btn-wa"  onclick="waRaf('${r.id}')"><i class="fab fa-whatsapp"></i></button>
                <button class="btndel" onclick="delRaf('${r.id}')"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>`).join(''):empty;
    /* أرشيف الدولار */
    document.getElementById('dollArchiveCount').textContent=dollInvoices.length;
    document.getElementById('dollArchiveList').innerHTML=dollInvoices.length?dollInvoices.map(d=>`
        <div class="saved-card">
            <div>
                <strong>👤 ${d.c}</strong>
                <span style="color:${d.isBuy?'var(--gr)':'#0369a1'};font-weight:800;margin-right:.25rem">${d.isBuy?'شراء سلعة':'بيع سلعة'}</span>
                <span style="color:var(--g600);font-weight:900">${fmt(d.a||0,2)} غ (705)</span>
                ${d.fee?`<span style="color:var(--t2);font-weight:800;font-size:.7rem"> · أجرة ${fmt(d.fee,0)} دج</span>`:''}
                ${Array.isArray(d.items)&&d.items.length
                    ?d.items.map(it=>`<small style="color:var(--t2);display:block;font-size:.62rem">🛍️ ${it.n} · ⚖️ ${fmt(it.w||0,2)} غ · 🏷️ ${fmt(it.k||0,0)}${it.p?' · 💰 '+fmt(it.p,0)+' دج/غ = '+fmt(it.fv!=null?it.fv:(it.w*it.p),0)+' دج':''}</small>`).join('')
                    :''}
                ${d.rot?`<small style="color:#0d9488;display:block;font-size:.62rem;font-weight:800">♻️ روتور (مرتجع): ⚖️ ${fmt(d.rot.w,2)} غ · 🏷️ ${fmt(d.rot.k,0)}${d.rot.p?' · 💰 '+fmt(d.rot.p,0)+' دج/غ = '+fmt(d.rot.fv||0,0)+' دج':''}</small>`:''}
                ${d.cash?`<small style="color:#0369a1;display:block;font-size:.62rem;font-weight:800">💵 ${d.isBuy?'أخذ':'دفع'} دينار: ${fmt(d.cash,0)} دج</small>`:''}
                ${d.kass&&d.kass.eq?`<small style="color:#0d9488;display:block;font-size:.62rem;font-weight:800">⚱️ ${d.isBuy?'دفع':'أخذ'} لاكاص: ${d.kass.items.map(it=>fmt(it.w,2)+'غ/'+fmt(it.k,0)).join(' + ')} = ${fmt(d.kass.eq,2)} غ (705)</small>`:''}
                ${d.cashiCash?`<small style="color:#b45309;display:block;font-size:.62rem;font-weight:800">💵 كاصي بالدينار: ${fmt(d.cashiCash.amt,0)} دج ÷ ${fmt(d.cashiCash.rate,0)} = ${fmt(d.cashiCash.eq,2)} غ (705)</small>`:''}
                ${d.cashiFee&&d.cashiFee.items?`<small style="color:#7c3aed;display:block;font-size:.62rem;font-weight:800">⚱️ أجرة بالكاصي: ${d.cashiFee.items.map(it=>fmt(it.w,2)+'غ/'+fmt(it.k,0)+'×'+fmt(it.p,0)).join(' + ')} = ${fmt(d.cashiFee.din,0)} دج · ${fmt(d.cashiFee.eq,2)} غ (705)</small>`:''}
                ${(d.rot||d.cash||(d.kass&&d.kass.eq))?`<small style="color:var(--g600);display:block;font-size:.62rem;font-weight:900">= الصافي: ${fmt((d.a||0)-(d.rot?d.rot.eq||0:0)-(d.kass?d.kass.eq||0:0),2)} غ (705) · ${fmt((d.fee||0)-(d.rot?d.rot.fv||0:0)-(d.cash||0),0)} دج</small>`:''}
                <small style="color:var(--t3);display:block;font-size:.58rem">${d.dt}</small>
            </div>
            <div style="display:flex;gap:.3rem">
                <button class="btn-pdf" onclick="editDoll('${d.id}')" style="background:rgba(124,58,237,.12);color:#7c3aed" title="تعديل"><i class="fas fa-pen"></i></button>
                <button class="btn-pdf" onclick="viewDoc('doll','${d.id}')" title="عرض"><i class="fas fa-eye"></i></button>
                <button class="btn-wa"  onclick="waDoll('${d.id}')"><i class="fab fa-whatsapp"></i></button>
                <button class="btndel" onclick="delDoll('${d.id}')"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>`).join(''):empty;
    /* أرشيف دبي — القسم محذوف من الواجهة، حراسة فقط */
    const _dubCntEl=document.getElementById('dubaiArchiveCount');
    const _dubListEl=document.getElementById('dubaiArchiveList');
    if(_dubCntEl)_dubCntEl.textContent=dubaiInvoices.length;
    if(_dubListEl)_dubListEl.innerHTML=dubaiInvoices.length?dubaiInvoices.map(d=>`
        <div class="saved-card">
            <div>
                <strong>${d.c}</strong>
                <span style="color:#0f766e;font-weight:800;margin-right:.25rem">🏙️ دبي</span>
                <span style="color:var(--g600);font-weight:900">${fmt(d.usd||0,2)} $</span>
                <small style="color:var(--t2);display:block">${d.dt} · ${fmt(d.w||0,2)} غ · شاشة ${fmt(d.sp||0,2)}${d.disc?' · خصم '+fmt(d.disc,2):''}</small>
                ${_dubPGLine(d)}
            </div>
            <div style="display:flex;gap:.3rem">
                <button class="btn-pdf" onclick="editDubInv('${d.id}')" style="background:rgba(124,58,237,.12);color:#7c3aed" title="تعديل"><i class="fas fa-pen"></i></button>
                <button class="btn-pdf" onclick="viewDoc('dubai','${d.id}')" title="عرض"><i class="fas fa-eye"></i></button>
                <button class="btn-wa"  onclick="waDubai('${d.id}')"><i class="fab fa-whatsapp"></i></button>
                <button class="btndel" onclick="delDubai('${d.id}')"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>`).join(''):empty;
    /* طبّق بحث الاسم بعد كل رسم (يبقى الفلتر ثابتاً) */
    try{const i=document.getElementById('archSearch');if(i)window._archQ=i.value;_applyArchSearch();}catch(e){}
}
/* فتح واتساب — whatsapp:// يعبر WebView مباشرة لنظام أندرويد */
function _waOpen(){
    const isMobile=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if(isMobile){ window.location.href='whatsapp://send'; }
    else { window.open('https://web.whatsapp.com','_blank'); }
}

/* ══ بطاقة المشاركة — مستقلة كلياً، تحل مشكلة user gesture مع html2pdf ══ */
let _pendingBlob=null, _pendingFname='', _pendingTitle='';

function _closeShareCard(){
    const ov=document.getElementById('_waShareOv');
    if(!ov)return;
    ov.style.opacity='0';
    setTimeout(()=>{if(ov.parentNode)ov.parentNode.removeChild(ov);},260);
}

window._doWaShare=async function(){
    if(!_pendingBlob)return;
    const blob=_pendingBlob, fname=_pendingFname, title=_pendingTitle;
    _pendingBlob=null;
    _closeShareCard();
    const file=new File([blob],fname,{type:'application/pdf'});
    /* جوال يدعم Web Share API مع ملفات */
    if(navigator.canShare&&navigator.canShare({files:[file]})){
        try{ await navigator.share({files:[file],title}); return; }
        catch(e){ if(e.name==='AbortError')return; }
    }
    /* Fallback: تنزيل ثم فتح واتساب تلقائياً */
    const u=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=u;a.download=fname;a.click();
    setTimeout(()=>URL.revokeObjectURL(u),3000);
    toast('📥 تم تنزيل PDF — سيُفتح واتساب لإرساله','info');
    /* افتح واتساب بعد لحظة حتى يكتمل التنزيل */
    setTimeout(()=>{
        const isMob=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        if(isMob) window.location.href='whatsapp://send';
        else window.open('https://web.whatsapp.com','_blank');
    },1800);
};

window._doDownload=function(){
    if(!_pendingBlob)return;
    const blob=_pendingBlob,fname=_pendingFname;
    _pendingBlob=null;_closeShareCard();
    const u=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=u;a.download=fname;a.click();
    setTimeout(()=>URL.revokeObjectURL(u),3000);
    toast('📥 تم تنزيل PDF','info');
};

window._closeWaCard=function(){_pendingBlob=null;_closeShareCard();};

function _showShareCard(blob,fname,title){
    _pendingBlob=blob;_pendingFname=fname;_pendingTitle=title;
    /* أزل أي بطاقة سابقة */
    const old=document.getElementById('_waShareOv');
    if(old&&old.parentNode)old.parentNode.removeChild(old);

    const ov=document.createElement('div');
    ov.id='_waShareOv';
    Object.assign(ov.style,{
        position:'fixed',inset:'0',zIndex:'2147483647',
        background:'rgba(0,0,0,.6)',display:'flex',
        alignItems:'center',justifyContent:'center',
        padding:'1rem',opacity:'0',transition:'opacity .22s',
        fontFamily:'Tajawal,sans-serif',direction:'rtl'
    });
    const isMob=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const hasNativeShare=!!(navigator.canShare);
    ov.innerHTML=`
    <div style="background:var(--card,#fff);border-radius:16px;padding:1.4rem 1.3rem;
                max-width:320px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.35);
                border:1px solid var(--border,#e2e8f0)">
        <div style="font-weight:900;font-size:1rem;color:var(--g400,#f59e0b);
                    text-align:center;margin-bottom:1rem">📄 ${title}</div>
        <div style="display:flex;flex-direction:column;gap:.6rem">
            ${hasNativeShare?`
            <button onclick="window._doWaShare()"
                style="padding:.75rem;border-radius:10px;border:none;cursor:pointer;
                       background:#25d366;color:#fff;font-size:.95rem;font-weight:900;
                       font-family:Tajawal,sans-serif;display:flex;align-items:center;
                       justify-content:center;gap:.4rem">
                <i class="fab fa-whatsapp"></i> إرسال مباشر
            </button>`:''}
            <button onclick="window._doDownload()"
                style="padding:.75rem;border-radius:10px;border:none;cursor:pointer;
                       background:#128c7e;color:#fff;font-size:.95rem;font-weight:900;
                       font-family:Tajawal,sans-serif;display:flex;align-items:center;
                       justify-content:center;gap:.4rem">
                📥 تنزيل PDF
            </button>
            <button onclick="window._doDownload();setTimeout(()=>{const m=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);if(m)window.location.href='whatsapp://send';else window.open('https://web.whatsapp.com','_blank');},1800)"
                style="padding:.7rem;border-radius:10px;border:1px solid #25d366;
                       cursor:pointer;background:#fff;color:#25d366;font-size:.9rem;
                       font-weight:900;font-family:Tajawal,sans-serif;text-decoration:none;
                       display:flex;align-items:center;justify-content:center;gap:.4rem;
                       text-align:center;border:none">
                <i class="fab fa-whatsapp"></i> تنزيل وفتح واتساب
            </button>
            <button onclick="window._closeWaCard()"
                style="padding:.5rem;border-radius:10px;border:none;cursor:pointer;
                       background:rgba(239,68,68,.12);color:#ef4444;
                       font-size:.82rem;font-weight:700;font-family:Tajawal,sans-serif">
                إغلاق
            </button>
        </div>
    </div>`;
    ov.addEventListener('click',e=>{if(e.target===ov)window._closeWaCard();});
    document.body.appendChild(ov);
    requestAnimationFrame(()=>ov.style.opacity='1');
}
window.waInv=(id)=>{
    const inv=invoices.find(i=>i.id===id);if(!inv)return;
    const fname=`فاتورة_${inv.c}_${inv.dt}.pdf`;
    toast('⏳ جارٍ تحضير PDF…','info');
    html2pdf().set(pdfOpts(inv)).from(buildInvHtml(inv)).outputPdf('blob')
        .then(blob=>{ _showShareCard(blob,fname,`فاتورة ${inv.c}`); })
        .catch(e=>toast('❌ خطأ في توليد PDF: '+(e&&e.message||e),'error'));
};
/* delInv مُعرَّفة في invoice.js */
/* علامة مائية (لوغو) باسم المستخدم الحالي — مشتركة لكل الفواتير */
function _wmText(){ return ((typeof _currentUser!=='undefined'&&_currentUser)?_currentUser:(localStorage.getItem('gp12_user')||sessionStorage.getItem('gp12_user')||'')).toString(); }
function _wmLayer(){
    const u=_wmText(); if(!u) return '';
    const row=(u+' • ').repeat(4);
    const line=`<div style="transform:rotate(-26deg);white-space:nowrap;text-align:center;font-size:42px;font-weight:900;color:#d4af37;opacity:.07;letter-spacing:2px;margin:22px 0">${row}</div>`;
    return `<div style="position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden">${line+line+line}</div>`;
}

function buildInvHtml(inv){
    const taken=inv.akhd!=null?inv.akhd:(inv.ps==='full'?inv.tp:0);
    /* prevBal محفوظ عند الإنشاء — إن غاب (فواتير قديمة) يُعامَل صفراً */
    const prevBal=inv.prevBal!=null?inv.prevBal:0;
    const isBuy=inv.t==='buy';
    /* بيع: prevBal يُضاف (الزبون مدين بأكثر) — شراء: prevBal يُطرح (يُقاصّ دينه) */
    const finalTotal=isBuy?(inv.tp-prevBal-taken):(inv.tp+prevBal-taken);
    const isPaid=inv.ps==='full';
    const typeLabel=isBuy?'شراء':'بيع';
    const paidLabel=isPaid?'خالص':'غير خالص';
    const _wm=((typeof _currentUser!=='undefined'&&_currentUser)?_currentUser:(localStorage.getItem('gp12_user')||sessionStorage.getItem('gp12_user')||'')).toString();
    const _wmRow=_wm?(_wm+' • ').repeat(4):'';
    const _wmLine=`<div style="transform:rotate(-26deg);white-space:nowrap;text-align:center;font-size:44px;font-weight:900;color:#d4af37;opacity:.07;letter-spacing:2px;margin:22px 0">${_wmRow}</div>`;
    return`<div style="position:relative;overflow:hidden;padding:8px 10px;font-family:'Tajawal',Arial,sans-serif;direction:rtl;max-width:540px;margin:auto;font-size:13px">
        <!-- علامة مائية (لوقو) باسم المستخدم خلف الفاتورة -->
        <div style="position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden">
            ${_wm?_wmLine+_wmLine+_wmLine:''}
        </div>
        <div style="position:relative;z-index:1">
        <!-- ترويسة: نوع الفاتورة + اسم الزبون + حالة الدفع -->
        <div style="display:flex;justify-content:space-between;align-items:stretch;margin-bottom:7px;gap:5px">
            <span style="background:#dc2626;color:#fff;padding:5px 10px;font-weight:900;font-size:13px;border-radius:5px;display:flex;align-items:center">${paidLabel}</span>
            <span style="flex:1;background:#f8f8f8;border:1px solid #ccc;color:#1a1a1a;padding:5px 10px;font-weight:900;font-size:16px;border-radius:5px;display:flex;align-items:center;justify-content:center">${inv.c}</span>
            <span style="background:#dc2626;color:#fff;padding:5px 10px;font-weight:900;font-size:13px;border-radius:5px;display:flex;align-items:center">${typeLabel}</span>
        </div>
        <!-- رقم الفاتورة والتاريخ — RTL: التاريخ يسار، الرقم يمين -->
        <div style="display:flex;justify-content:space-between;margin-bottom:7px;font-size:11px;color:#333;border-bottom:1px solid #ddd;padding-bottom:5px">
            <span>التاريخ: <strong>${inv.dt}</strong></span>
            <span>رقم: <strong>${inv.id.replace('INV-','')}</strong></span>
        </div>
        <!-- جدول البنود — RTL: الميزان يمين، المجموع يسار -->
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
            <thead>
                <tr style="background:#1a1a1a;color:#fff;font-weight:800;font-size:11px;text-align:center">
                    <th style="padding:5px 3px;border:1px solid #555;width:22%">الميزان</th>
                    <th style="padding:5px 3px;border:1px solid #555;width:12%">القيراط</th>
                    <th style="padding:5px 3px;border:1px solid #555;width:18%">ال730</th>
                    <th style="padding:5px 3px;border:1px solid #555;width:20%">السعر</th>
                    <th style="padding:5px 3px;border:1px solid #555;width:28%">المجموع</th>
                </tr>
            </thead>
            <tbody>
                ${(inv.items||[]).map((b,idx)=>`<tr style="text-align:center;background:${idx%2?'#fff':'#fafafa'}">
                    <td style="border:1px solid #bbb;padding:5px 3px;font-size:13px;font-weight:700">${fmt(b.w||0,2)}</td>
                    <td style="border:1px solid #bbb;padding:5px 3px;font-size:12px">${b.k||0}</td>
                    <td style="border:1px solid #bbb;padding:5px 3px;font-size:13px;font-weight:700">${fmt(b.eq730||0,2)}</td>
                    <td style="border:1px solid #bbb;padding:5px 3px;font-size:12px">${fmt(b.ppg||0,0)}</td>
                    <td style="border:1px solid #bbb;padding:5px 3px;font-weight:900;font-size:15px">${fmt(b.total||0,0)}</td>
                </tr>`).join('')}
                <tr style="background:#e5e5e5;text-align:center;font-weight:900">
                    <td style="border:1px solid #999;padding:6px 3px;font-size:14px">${fmt(inv.items.reduce((s,b)=>s+(b.w||0),0),2)}</td>
                    <td style="border:1px solid #999;padding:6px 3px;font-size:12px">—</td>
                    <td style="border:1px solid #999;padding:6px 3px;font-size:14px">${fmt(inv.items.reduce((s,b)=>s+(b.eq730||0),0),2)}</td>
                    <td style="border:1px solid #999;padding:6px 3px;font-size:12px">—</td>
                    <td style="border:1px solid #999;padding:6px 3px;font-size:16px">${fmt(inv.tp||0,0)}</td>
                </tr>
            </tbody>
        </table>
        <!-- الرصيد والمجموع النهائي -->
        <div style="margin-top:8px;border:1px solid #bbb;border-radius:4px;overflow:hidden">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-bottom:1px solid #ddd;font-size:13px">
                <span style="color:#555">الرصيد السابق:</span>
                <span style="font-size:15px;font-weight:800">${fmt(prevBal,0)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-bottom:1px solid #ddd;font-size:13px">
                <span style="color:#555">أخذ:</span>
                <span style="font-size:15px;font-weight:800">${fmt(taken,0)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#1a1a1a;color:#fff">
                <span style="font-size:13px">المجموع النهائي:</span>
                <span style="font-size:18px;font-weight:900">${fmt(finalTotal,0)}</span>
            </div>
        </div>
        <div style="text-align:center;margin-top:10px;font-size:11px;color:#888">
            توقيع: ___________________________
        </div>
        </div>
    </div>`;
}
function pdfOpts(inv){
    return{margin:4,filename:`فاتورة_${inv.c}_${inv.dt}.pdf`,image:{type:'jpeg',quality:.98},html2canvas:{scale:2},jsPDF:{unit:'mm',format:'a5',orientation:'portrait'}};
}
/* ═══════════ قفل الفواتير PDF بتشفير AES-256 حقيقي (ملف .gpdf) ═══════════ */
function _waToU8(wa){ const w=wa.words,s=wa.sigBytes,u=new Uint8Array(s); for(let i=0;i<s;i++)u[i]=(w[i>>>2]>>>(24-(i%4)*8))&0xff; return u; }
function _dlBlob(blob,name){ const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(url),2000); }
/* يشفّر بايتات الـ PDF بـ AES-256 (مفتاح PBKDF2 من المستخدم+كلمة المرور) ويحفظها كـ .gpdf */
function _savePdfLocked(blob,filename){
    if(typeof _encKey==='undefined'||!_encKey){ _dlBlob(blob,filename); toast('⚠️ حُفظت بدون قفل — سجّل الدخول لتفعيل التشفير','error'); return; }
    const fr=new FileReader();
    fr.onload=()=>{
        try{
            const wa=CryptoJS.lib.WordArray.create(fr.result);
            const salt=CryptoJS.lib.WordArray.random(16), iv=CryptoJS.lib.WordArray.random(16);
            const key=CryptoJS.PBKDF2(_backupKey(),salt,{keySize:256/32,iterations:100000,hasher:CryptoJS.algo.SHA256});
            const ct=CryptoJS.AES.encrypt(wa,key,{iv:iv}).toString();
            const out=JSON.stringify({_gpdf:1,kdf:'PBKDF2-SHA256',iter:100000,_user:_currentUser,name:filename,
                salt:salt.toString(CryptoJS.enc.Hex),iv:iv.toString(CryptoJS.enc.Hex),blob:ct});
            _dlBlob(new Blob([out],{type:'application/octet-stream'}), filename.replace(/\.pdf$/i,'')+'.gpdf');
            toast('🔒 حُفظت الفاتورة مشفّرة AES-256','info');
        }catch(e){ toast('⚠️ فشل التشفير','error'); }
    };
    fr.readAsArrayBuffer(blob);
}
/* يولّد PDF من HTML ثم يحفظه مقفلاً (AES-256) */
function _makeLockedPdf(opts,html){
    toast('🔒 جاري التشفير...','info');
    html2pdf().set(opts).from(html).outputPdf('blob')
        .then(b=>_savePdfLocked(b,opts.filename||'فاتورة.pdf'))
        .catch(e=>toast('❌ خطأ في توليد PDF','error'));
}
/* فتح فاتورة مقفلة (.gpdf): يفكّ بمفتاح المستخدم النشط ويعرض الـ PDF */
let _pendingGpdf=null;
/* يفكّ نصّ ملف .gpdf ويعرض الـ PDF. إن لم يكن المستخدم داخلاً بعد، يخزّنه لما بعد الدخول */
function _openGpdfText(text){
    let p=null; try{p=JSON.parse(text);}catch(_){p=null;}
    if(!p||!p._gpdf||!p.blob){ toast('⚠️ ملف غير صالح','error'); return; }
    if(typeof _encKey==='undefined'||!_encKey){
        _pendingGpdf=text;
        toast('🔑 سجّل الدخول لفتح الفاتورة المقفلة','info');
        return;
    }
    toast('🔓 جاري فك القفل...','info');
    setTimeout(()=>{
        try{
            const salt=CryptoJS.enc.Hex.parse(p.salt), iv=CryptoJS.enc.Hex.parse(p.iv);
            const key=CryptoJS.PBKDF2(_backupKey(),salt,{keySize:256/32,iterations:p.iter||100000,hasher:CryptoJS.algo.SHA256});
            const dec=CryptoJS.AES.decrypt(p.blob,key,{iv:iv});
            const u8=_waToU8(dec);
            if(u8.length<4||u8[0]!==0x25||u8[1]!==0x50||u8[2]!==0x44||u8[3]!==0x46){ toast('🚫 فشل الفتح — كلمة المرور خاطئة أو الملف لا يخصّك','error'); return; }
            const pblob=new Blob([u8],{type:'application/pdf'});
            const url=URL.createObjectURL(pblob);
            const w=window.open(url,'_blank');
            if(!w) _dlBlob(pblob,(p.name||'فاتورة.pdf'));
            setTimeout(()=>URL.revokeObjectURL(url),60000);
            toast('✅ تم فك القفل','info');
        }catch(_){ toast('🚫 فشل الفتح — كلمة المرور خاطئة أو الملف تالف','error'); }
    },50);
}
window._processPendingGpdf=()=>{ if(_pendingGpdf){ const t=_pendingGpdf; _pendingGpdf=null; _openGpdfText(t); } };
window.openLockedPdf=(e)=>{
    const file=e.target.files[0]; if(!file)return; e.target.value='';
    const fr=new FileReader();
    fr.onload=ev=>_openGpdfText(ev.target.result);
    fr.readAsText(file);
};
/* استقبال ملفّات .gpdf المفتوحة عبر «الفتح بواسطة» (File Handling API) */
if('launchQueue' in window && 'setConsumer' in window.launchQueue){
    try{
        window.launchQueue.setConsumer(async (lp)=>{
            if(!lp||!lp.files||!lp.files.length)return;
            try{ const f=await lp.files[0].getFile(); _openGpdfText(await f.text()); }catch(e){}
        });
    }catch(e){}
}
window.printInv=(id)=>{
    const inv=invoices.find(i=>i.id===id);if(!inv)return;
    _makeLockedPdf(pdfOpts(inv),buildInvHtml(inv));
};


/* ═══ PDF الدولار ═══ */
function buildDollHtml(d,custView){
    /* custView=true → الفاتورة من منظور الزبون (كل الاتجاهات معكوسة) */
    const lbl=custView?(d.isBuy?'بعت للمحل':'اشتريت من المحل'):(d.isBuy?'شراء سلعة':'بيع سلعة');
    const col=d.isBuy?'#16a34a':'#0369a1';
    /* لاكاص: المحل يأخذه عند البيع ويدفعه عند الشراء — والزبون بالعكس */
    const kassLbl=custView?(d.isBuy?'أخذ لاكاص':'دفع لاكاص'):(d.isBuy?'دفع لاكاص':'أخذ لاكاص');
    const cashLbl=custView?(d.isBuy?'دفع دينار':'أخذ دينار'):(d.isBuy?'أخذ دينار':'دفع دينار');
    const items=Array.isArray(d.items)&&d.items.length?d.items:[{n:d.c,w:d.gw||0,k:d.gk||0,p:d.a||0}];
    const rows=items.map(it=>{
        const fv=it.fv!=null?it.fv:((it.w||0)*(it.p||0));
        return`<tr>
            <td style="padding:5px;border:1px solid #bbb;font-weight:800">${it.n||'—'}</td>
            <td style="padding:5px;border:1px solid #bbb;text-align:center">${it.w?fmt(it.w,2)+' غ':'—'}</td>
            <td style="padding:5px;border:1px solid #bbb;text-align:center">${it.k?fmt(it.k,0):'—'}</td>
            <td style="padding:5px;border:1px solid #bbb;text-align:center">${it.p?fmt(it.p,0)+' دج/غ':'—'}</td>
            <td style="padding:5px;border:1px solid #bbb;text-align:left;font-weight:800">${fmt(fv,0)} دج</td>
        </tr>`;}).join('')
        +(d.rot?`<tr style="background:#f0fdfa">
            <td style="padding:5px;border:1px solid #bbb;font-weight:900;color:#0d9488">♻️ روتور (مرتجع)</td>
            <td style="padding:5px;border:1px solid #bbb;text-align:center">− ${fmt(d.rot.w,2)} غ</td>
            <td style="padding:5px;border:1px solid #bbb;text-align:center">${fmt(d.rot.k,0)}</td>
            <td style="padding:5px;border:1px solid #bbb;text-align:center">${d.rot.p?fmt(d.rot.p,0)+' دج/غ':'—'}</td>
            <td style="padding:5px;border:1px solid #bbb;text-align:left;font-weight:800">− ${fmt(d.rot.fv||0,0)} دج</td>
        </tr>`:'');
    return`<div style="position:relative;overflow:hidden;padding:12px;font-family:Tajawal,sans-serif;direction:rtl;max-width:480px;margin:auto">
        ${_wmLayer()}
        <div style="position:relative;z-index:1">
        <div style="text-align:center;border-bottom:2px solid ${col};padding-bottom:8px;margin-bottom:10px">
            <div style="font-size:19px;font-weight:900;color:${col}">🛍️ ${lbl}</div>
            <div style="font-size:13px;color:#555">👤 ${d.c} — ${d.dt}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#f3f3f3">
                <th style="padding:5px;border:1px solid #bbb">السلعة</th>
                <th style="padding:5px;border:1px solid #bbb">الوزن</th>
                <th style="padding:5px;border:1px solid #bbb">العيار</th>
                <th style="padding:5px;border:1px solid #bbb">أجرة/غ</th>
                <th style="padding:5px;border:1px solid #bbb">المجموع</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
        ${d.kass&&d.kass.eq?`<div style="display:flex;justify-content:space-between;font-size:13px;padding-top:5px;color:#0d9488;font-weight:800"><span>⚱️ ${kassLbl}:</span><span>− ${d.kass.items.map(it=>fmt(it.w,2)+'غ/'+fmt(it.k,0)).join(' + ')} = ${fmt(d.kass.eq,2)} غ (705)</span></div>`:''}
        ${d.cash?`<div style="display:flex;justify-content:space-between;font-size:13px;padding-top:3px;color:#0369a1;font-weight:800"><span>💵 ${cashLbl}:</span><span>− ${fmt(d.cash,0)} دج</span></div>`:''}
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-weight:900;font-size:16px;border-top:2px solid ${col};padding-top:6px">
            <span>صافي المكافئ (705):</span><span>${fmt((d.a||0)-(d.rot?d.rot.eq||0:0)-(d.kass?d.kass.eq||0:0),2)} غ</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:900;font-size:15px;padding-top:4px"><span>صافي الدينار:</span><span>${fmt((d.fee||0)-(d.rot?d.rot.fv||0:0)-(d.cash||0),0)} دج</span></div>
        <div style="text-align:center;margin-top:12px;font-size:12px;color:#666"><p>توقيع: _______________</p></div>
        </div>
    </div>`;
}
const _dollPdfOpts=(d)=>({margin:4,filename:`سلعة_${d.c}_${d.dt}.pdf`,image:{type:'jpeg',quality:.98},html2canvas:{scale:2},jsPDF:{unit:'mm',format:'a5',orientation:'portrait'}});
window.printDoll=(id)=>{
    const d=dollInvoices.find(x=>x.id===id);if(!d)return;
    _makeLockedPdf(_dollPdfOpts(d),buildDollHtml(d));
};
window.waDoll=(id)=>{
    const d=dollInvoices.find(x=>x.id===id);if(!d)return;
    const fname=`سلعة_${d.c}_${d.dt}.pdf`;
    toast('⏳ جارٍ تحضير PDF…','info');
    html2pdf().set(_dollPdfOpts(d)).from(buildDollHtml(d)).outputPdf('blob')
        .then(blob=>{ _showShareCard(blob,fname,`سلعة ${d.c}`); })
        .catch(e=>toast('❌ خطأ في توليد PDF: '+(e&&e.message||e),'error'));
};
/* delDoll مُعرَّفة في firebase.js */

/* ═══ PDF دبي ═══ */
function buildDubaiHtml(d){
    const netPrice=(d.sp||0)-(d.disc||0);
    const totalUsd=Math.max(0,netPrice*(d.w||0)/31.1035);
    return`<div style="position:relative;overflow:hidden;padding:12px;font-family:Tajawal,sans-serif;direction:rtl;max-width:480px;margin:auto">
        ${_wmLayer()}
        <div style="position:relative;z-index:1">
        <div style="text-align:center;border-bottom:2px solid #0f766e;padding-bottom:8px;margin-bottom:10px">
            <div style="font-size:19px;font-weight:900;color:#0f766e">🏙️ بيع دبي</div>
            <div style="font-size:13px;color:#555">${d.c} — ${d.dt}</div>
        </div>
        <div style="font-size:14px;border:1px solid #aaa;padding:10px;border-radius:4px">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span>المكتب:</span><span style="font-weight:800">${d.c}</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span>الوزن المرسل:</span><span style="font-weight:900;font-size:15px">${fmt(d.w,3)} غ 24</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span>سعر الشاشة:</span><span>${fmt(d.sp,2)} $/أوقية</span></div>
            ${d.disc?`<div style="display:flex;justify-content:space-between;margin-bottom:5px"><span>الخصم:</span><span style="color:#dc2626">−${fmt(d.disc,2)} $/أوقية</span></div>`:''}
            <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span>السعر الصافي:</span><span>${fmt(netPrice,2)} $/أوقية</span></div>
            <div style="display:flex;justify-content:space-between;border-top:1px solid #aaa;padding-top:5px;font-weight:900;font-size:16px">
                <span>الإجمالي:</span><span style="color:#0f766e">${fmt(totalUsd,4)} $</span>
            </div>
        </div>
        <div style="text-align:center;margin-top:12px;font-size:12px;color:#666"><p>توقيع: _______________</p></div>
        </div>
    </div>`;
}
const _dubaiPdfOpts=(d)=>({margin:4,filename:`دبي_${d.c}_${d.dt}.pdf`,image:{type:'jpeg',quality:.98},html2canvas:{scale:2},jsPDF:{unit:'mm',format:'a5',orientation:'portrait'}});
window.printDubai=(id)=>{
    const d=dubaiInvoices.find(x=>x.id===id);if(!d)return;
    _makeLockedPdf(_dubaiPdfOpts(d),buildDubaiHtml(d));
};
window.waDubai=(id)=>{
    const d=dubaiInvoices.find(x=>x.id===id);if(!d)return;
    const fname=`دبي_${d.c}_${d.dt}.pdf`;
    toast('⏳ جارٍ تحضير PDF…','info');
    html2pdf().set(_dubaiPdfOpts(d)).from(buildDubaiHtml(d)).outputPdf('blob')
        .then(blob=>{ _showShareCard(blob,fname,`دبي ${d.c}`); })
        .catch(e=>toast('❌ خطأ في توليد PDF: '+(e&&e.message||e),'error'));
};
/* delDubai مُعرَّفة في firebase.js */

/* ═══════════ NAVIGATION ═══════════ */
window.switchPage=(p)=>{
    const er=window._editRestore;
    if(er&&er.page&&er.page!==p){ window._editRestore=null; if(typeof _reemitSnapshot==='function')_reemitSnapshot(er.snap); if(typeof _hideRafEditBanner==='function')_hideRafEditBanner(); toast('↩️ أُلغي التعديل واستُعيدت الفاتورة','info'); }
    document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.ni').forEach(x=>x.classList.remove('active'));
    const pe=document.getElementById('page-'+p),ne=document.getElementById('nav-'+p);
    if(pe)pe.classList.add('active');if(ne)ne.classList.add('active');
    if(p==='invoice'){updateInvDate();}
    if(p==='raffinage')calcRaf();
    if(p==='log')renderLog();
    if(p==='archive')renderArchive();
    if(p==='debts')renderDebts();
    if(p==='profit')renderProfit();
    /* كرة السعر: تظهر في الواجهة الرئيسية فقط */
    const _ball=document.getElementById('hdrCenterWrap');
    if(_ball){
        if(p==='home'){ _ball.style.display=''; }
        else { _ball.style.display='none'; _ball.classList.remove('open'); }
    }
};

/* ═══════════ LIVE SPOT PRICE ═══════════ */
async function fetchSpotPrice(){
    const el=document.getElementById('spotPriceDisplay');
    const badge=document.getElementById('spotBadge');
    const fmt2=v=>v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    const show=(price)=>{
        el.textContent='XAU '+fmt2(price)+' $/أوقية';
        badge.classList.remove('spot-loading');
        badge.title='سعر الذهب العالمي اللحظي (XAU/USD) — آخر تحديث: '+new Date().toLocaleTimeString('ar-DZ');
        if(typeof _refreshDubaiSell==='function') _refreshDubaiSell();
    };
    /* 1. gold-api.com — مجاني، يدعم CORS */
    try{
        const r=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store'});
        if(!r.ok)throw new Error();
        const d=await r.json();
        const price=d?.price;
        if(price&&!isNaN(price)){liveSpotPrice=price;show(price);autoCalcDubai();return}
    }catch{}
    /* 2. metals.live — احتياطي */
    try{
        const r=await fetch('https://api.metals.live/v1/spot/gold',{cache:'no-store'});
        if(!r.ok)throw new Error();
        const d=await r.json();
        const price=d?.price??d?.gold??d?.[0]?.gold;
        if(price&&!isNaN(price)){liveSpotPrice=price;show(price);autoCalcDubai();return}
    }catch{}
    /* 3. فشل كلا المصدرين */
    el.textContent='السعر غير متاح';
    badge.classList.add('spot-loading');
}


/* ═══ إكمال تلقائي مخصّص للأسماء — بديل datalist لا يعيق كتابة اسم جديد على الهاتف ═══ */
(function(){
    let _acEl=null,_acInp=null;
    function _acNames(){
        try{ return [...new Set([
            ...((typeof debts!=='undefined'?debts:[])||[]).map(d=>d.c),
            ...((typeof loans!=='undefined'?loans:[])||[]).map(l=>l.c),
            ...((typeof invoices!=='undefined'?invoices:[])||[]).map(i=>i.c),
            ...((typeof ops!=='undefined'?ops:[])||[]).map(o=>o.c)
        ])].filter(Boolean); }catch(e){ return []; }
    }
    /* مطابقة الاسم المُدخَل (صوتاً أو كتابةً) مع زبائنك عند مغادرة الحقل */
    function _snapName(inp){
        const v=(inp.value||'').trim(); if(!v)return;
        try{
            if(!(window.VA&&VA.matchName))return;
            const r=VA.matchName(v);
            if(r&&r.ok&&r.name&&r.name!==v&&(r.dist==null||r.dist<=2)){
                inp.value=r.name;
                if(typeof toast==='function')toast(`🔁 صُحِّح الاسم: "${v}" ← "${r.name}"`,'info');
                inp.dispatchEvent(new Event('input',{bubbles:true}));
            }
        }catch(e){}
    }
    function _box(){ if(!_acEl){ _acEl=document.createElement('div'); _acEl.className='ac-box'; _acEl.style.cssText='position:fixed;display:none;z-index:99999'; document.body.appendChild(_acEl);} return _acEl; }
    function _hide(){ if(_acEl)_acEl.style.display='none'; }
    /* قائمة صغيرة (اقتراحان كحدّ أقصى) أسفل الحقل — لا تغطّي الكتابة ولا تسرق التركيز */
    function _show(inp){
        const v=(inp.value||'').trim().toLowerCase(); const box=_box();
        if(!v){ _hide(); return; }
        const all=_acNames();
        let m=all.filter(n=>n.toLowerCase().startsWith(v)&&n.toLowerCase()!==v);
        if(m.length<2){ all.forEach(n=>{ const ln=n.toLowerCase(); if(ln.includes(v)&&ln!==v&&!m.includes(n))m.push(n); }); }
        m=m.slice(0,2);
        if(!m.length){ _hide(); return; }
        box.innerHTML=m.map(n=>`<div class="ac-item">${String(n).replace(/</g,'&lt;')}</div>`).join('');
        Array.from(box.children).forEach((el,k)=>{ el.onmousedown=ev=>{ ev.preventDefault(); inp.value=m[k]; _hide(); inp.dispatchEvent(new Event('input',{bubbles:true})); }; });
        const r=inp.getBoundingClientRect();
        box.style.left=r.left+'px'; box.style.top=(r.bottom+2)+'px'; box.style.width=r.width+'px'; box.style.display='block';
        _acInp=inp;
    }
    function _attach(id){ const inp=document.getElementById(id); if(!inp||inp._acOn) return; inp._acOn=true;
        inp.removeAttribute('list'); inp.setAttribute('autocomplete','off');
        inp.addEventListener('input',()=>_show(inp));
        inp.addEventListener('focus',()=>_show(inp));
        inp.addEventListener('blur',()=>{ setTimeout(_hide,160); _snapName(inp); });
    }
    function init(){ ['invCustomer','rafCustomer','loanCustomer','sellCustomer','gtCustomer','goodsCustomer','expCustomer','sendLogCustomer','shipOffice','dubaiOffice'].forEach(_attach); }
    window._acAttach=_attach;
    if(document.readyState!=='loading') init(); else document.addEventListener('DOMContentLoaded',init);
    setTimeout(init,800);
    window.addEventListener('scroll',_hide,true);
})();

/* ═══════════ حزمة الميزات المنقولة (v49) ═══════════ */

/* ── عارض داخلي للفواتير (بديل تنزيل PDF) ── */
window.viewDoc=(kind,id)=>{
    let html='';
    try{
        if(kind==='inv'){const x=invoices.find(v=>v.id===id); if(x)html=buildInvHtml(x);}
        else if(kind==='raf'){const x=rafInvoices.find(v=>v.id===id); if(x)html=buildRafHtml(x);}
        else if(kind==='doll'){const x=dollInvoices.find(v=>v.id===id); if(x)html=buildDollHtml(x);}
        else if(kind==='dubai'){const x=dubaiInvoices.find(v=>v.id===id); if(x)html=buildDubaiHtml(x);}
    }catch(e){}
    if(!html)return toast('تعذّر عرض الفاتورة','error');
    let m=document.getElementById('docViewModal');
    if(!m){m=document.createElement('div');m.id='docViewModal';
        m.style.cssText='position:fixed;inset:0;background:#fff;z-index:99999;overflow:auto;display:none';
        document.body.appendChild(m);}
    m.innerHTML=`<button onclick="document.getElementById('docViewModal').style.display='none'"
        style="position:fixed;top:10px;left:10px;z-index:100000;width:40px;height:40px;border-radius:50%;border:none;background:#111;color:#fff;font-size:1.1rem;cursor:pointer">✕</button>
        <div style="max-width:820px;margin:0 auto;padding:1rem">${html}</div>`;
    m.style.display='block';
};

/* ── بحث الأرشيف (فلترة حية على كل الأقسام بعد الرسم) ── */
window._archQ='';
window._applyArchSearch=()=>{
    const q=(window._archQ||'').trim();
    ['archiveList','rafArchiveList','dollArchiveList','dubaiArchiveList'].forEach(lid=>{
        const el=document.getElementById(lid); if(!el)return;
        [...el.children].forEach(card=>{
            card.style.display=(!q||card.textContent.includes(q))?'':'none';
        });
    });
};

/* ── بحث دفتر الديون ── */
window._debtQ='';
(function(){
    const _orig=window.renderDebts||renderDebts;
    window.renderDebts=function(){
        _orig.apply(this,arguments);
        let inp=document.getElementById('debtSearch');
        if(!inp){
            const tb=document.getElementById('debtsBody');
            const table=tb&&tb.closest('table');
            if(table){
                const w=document.createElement('div');
                w.innerHTML=`<input id="debtSearch" placeholder="🔍 بحث باسم الزبون…" autocomplete="off"
                  style="width:100%;margin:.3rem 0 .5rem;border:1px solid var(--border);border-radius:10px;padding:.55rem .8rem;font-family:inherit;font-size:.85rem;background:var(--card2);color:var(--t)"
                  oninput="window._debtQ=this.value;_applyDebtSearch()">`;
                table.parentNode.insertBefore(w.firstChild,table);
            }
        }else{ window._debtQ=inp.value; }
        _applyDebtSearch();
    };
    window._applyDebtSearch=()=>{
        const q=(window._debtQ||'').trim();
        const tb=document.getElementById('debtsBody'); if(!tb)return;
        let any=false;
        [...tb.rows].forEach(r=>{
            const name=(r.cells[0]?.textContent||'');
            const show=!q||name.includes(q);
            r.style.display=show?'':'none'; if(show)any=true;
        });
        let msg=document.getElementById('debtNoRes');
        if(!any&&q){
            if(!msg){msg=document.createElement('div');msg.id='debtNoRes';msg.style.cssText='text-align:center;color:var(--t3);padding:.8rem';tb.closest('table').after(msg);}
            msg.textContent=`لا نتائج لـ«${q}»`;
        }else if(msg)msg.remove();
    };
})();

/* ── 🗑️ سلة المحذوفات ── */
window.showTrash=()=>{
    const items=(typeof _trashList==='function')?_trashList():[];
    let m=document.getElementById('trashModal');
    if(!m){m=document.createElement('div');m.id='trashModal';m.className='modal-overlay';document.body.appendChild(m);}
    const rows=items.length?items.map(it=>{
        const d=it.ts?new Date(it.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.55rem .2rem;border-bottom:1px solid var(--border)">
            <div style="text-align:right;min-width:0">
                <div style="font-weight:800;font-size:.8rem;overflow:hidden;text-overflow:ellipsis">${it.desc}</div>
                <div style="font-size:.66rem;color:var(--t3)">حُذف: ${d}</div>
            </div>
            <button onclick="if(confirm('استرجاع هذا العنصر بكامل أثره المالي؟')){_restoreVoid('${it.vid}');showTrash();toast('↩️ تم الاسترجاع','info');}"
                style="flex-shrink:0;background:rgba(22,163,74,.12);color:#16a34a;border:1px solid #16a34a;border-radius:9px;padding:.4rem .7rem;font-family:inherit;font-size:.74rem;cursor:pointer">↩️ استرجاع</button>
        </div>`;
    }).join(''):'<div style="text-align:center;padding:2rem;color:var(--t3)">السلة فارغة</div>';
    m.innerHTML=`<div class="modal-box" style="max-width:470px">
        <div class="modal-header"><h3 style="font-size:.95rem">🗑️ سلة المحذوفات (${items.length})</h3><button class="close-btn" onclick="closeModal('trashModal')">✕</button></div>
        <div style="padding:.9rem"><div style="max-height:60vh;overflow-y:auto">${rows}</div>
        <div style="font-size:.66rem;color:var(--t3);margin-top:.6rem">الاسترجاع يعيد العنصر بكامل أثره (مخزون/ديون/سيولة) كأن الحذف لم يكن.</div></div></div>`;
    m.classList.add('active');
};

/* ── سعر الغرام في أرشيف دبي (أدمين فقط) ── */
window._lastShipSp=()=>{ const s=(ops||[]).find(o=>o.t==='شحن'&&Number(o.sp)>0); return s?Number(s.sp):0; };
window._dubaiPerGram=(d,fullPrice)=>{
    const w=Number(d.w)||0, usd=Number(d.usd)||0; if(!w||!usd)return null;
    const rate=Number(d.rate)||dollarRate||0; if(!rate)return null;
    const ship=fullPrice?0:_lastShipSp(), gp=Number(goldPrice)||0;
    const div=Math.round((w/0.730)*10)/10;                    /* عرف التقريب اليدوي */
    /* المعادلة المعتمدة (وحدة أسعار التطبيق): ÷100 — تحقّقت من بيانات فعلية */
    let pr=(usd - w*ship)*rate/div/100 - (gp*0.001/0.730);
    if(!isFinite(pr)){ pr=usd*rate/div/100; }                 /* بديل تقريبي — لا إسقاط صامت */
    pr=Math.round(pr/100)*100;
    return {pr,rate,stored:(Number(d.rate)>0),noShip:!ship&&!fullPrice,approx:(!ship&&!fullPrice)||!gp};
};
window._dubPGLine=(d)=>{
    try{
        if(!(_usersCache&&_usersCache[_currentUser]&&_usersCache[_currentUser].isAdmin))return '';
        const r=_dubaiPerGram(d); if(!r||!isFinite(r.pr))return '';
        return `<small style="display:block;color:#0f766e;font-weight:800">⚖️ سعر الغرام: ${fmt(r.pr,0)} دج <span style="color:var(--t3);font-weight:600">· صرف ${fmt(r.rate,0)}${r.stored?'':' ⚠️احتياطي'}</span>${r.noShip?' <span style="color:var(--t3)">(بلا شحن)</span>':''}</small>`;
    }catch(e){return '';}
};

/* ── الفائدة الشهرية بالميزان المتطابق ── */
function _mKeyOf(dt){
    const t=String(dt||'');
    let m=t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m)return `${m[3]}-${String(m[2]).padStart(2,'0')}`;
    const FR={janv:1,'févr':2,fevr:2,mars:3,avr:4,mai:5,juin:6,juil:7,'août':8,aout:8,sept:9,oct:10,nov:11,'déc':12,dec:12};
    m=t.match(/(\d{1,2})\s+([a-zûéèçà.]+)\.?\s+(\d{4})/i);
    if(m){const mo=FR[m[2].replace('.','').toLowerCase().slice(0,4)]||FR[m[2].replace('.','').toLowerCase().slice(0,3)];
        if(mo)return `${m[3]}-${String(mo).padStart(2,'0')}`;}
    return null;
}
window.showMonthlyProfit=(mKey)=>{
    /* منطق المستخدم: الفائدة = القيمة الإجمالية للأصول (الآن) + قيمة شحن ميزان دبي */
    const assets=net();                                   /* نقد + ذهب + دولار + ذهب دبي مقوّم */
    /* شحن دبي = وزن الذهب في مكاتب دبي × سعر الشحن × سعر شراء الدولار */
    let dubW=0; const _offs=new Set(); dubaiInvoices.forEach(i=>{ if(i.o)_offs.add(i.o); if(i.c)_offs.add(i.c); });
    debts.forEach(d=>{ if(d.type==='ذهب 24'&&d.a>0.001&&_offs.has(d.c))dubW+=d.a; });
    const _shipSp=(typeof _lastShipSp==='function')?_lastShipSp():0;
    const _buyR=(dollarBuyRate>0?dollarBuyRate:dollarRate)||0;
    const shipDubai=Math.round(dubW*_shipSp*_buyR/100);
    const total=Math.round(assets)+shipDubai;
    const bk=_netBuckets();
    const f0=n=>Math.round(n).toLocaleString('fr-FR');
    let m=document.getElementById('monthProfitModal');
    if(!m){m=document.createElement('div');m.id='monthProfitModal';m.className='modal-overlay';document.body.appendChild(m);}
    m.innerHTML=`<div class="modal-box" style="max-width:440px">
      <div class="modal-header"><h3 style="font-size:.95rem">📈 الفائدة (قيمة الأصول + شحن دبي)</h3><button class="close-btn" onclick="closeModal('monthProfitModal')">✕</button></div>
      <div style="padding:.9rem;direction:rtl;text-align:right">
        <div style="text-align:center;background:var(--card2);border-radius:14px;padding:.9rem;margin-bottom:.6rem">
          <div style="font-size:.72rem;color:var(--t3)">الفائدة الكلية</div>
          <div style="font-size:1.6rem;font-weight:900;color:${total>=0?'#16a34a':'#dc2626'}">${f0(total)} دج</div>
        </div>
        <div style="background:var(--card2);border-radius:12px;padding:.7rem;margin-bottom:.5rem">
          <div style="display:flex;justify-content:space-between;font-size:.8rem;font-weight:800"><span>📊 القيمة الإجمالية للأصول</span><span style="color:${assets>=0?'#16a34a':'#dc2626'}">${f0(assets)}</span></div>
          <div style="font-size:.64rem;color:var(--t3);margin-top:.35rem;line-height:1.6">
            ${Math.abs(bk.din)>1?`💵 ${f0(bk.din)} · `:''}${Math.abs(bk.dol)>1?`💲 ${f0(bk.dol)} · `:''}${Math.abs(bk.g730)>1?`🏅 ${f0(bk.g730)} · `:''}${Math.abs(bk.g24)>1?`💎 ${f0(bk.g24)}`:''}
          </div>
        </div>
        <div style="background:var(--card2);border-radius:12px;padding:.7rem">
          <div style="display:flex;justify-content:space-between;font-size:.8rem;font-weight:800"><span>🚢 شحن ميزان دبي</span><span style="color:#16a34a">+ ${f0(shipDubai)}</span></div>
          <div style="font-size:.64rem;color:var(--t3);margin-top:.35rem">${fmt(dubW,2)} غ × ${fmt(_shipSp,2)}$ × ${f0(_buyR/100)} (سعر شراء الدولار)</div>
        </div>
        <div style="font-size:.64rem;color:var(--t3);margin-top:.6rem;line-height:1.7">
          الفائدة = القيمة الإجمالية لأصولك الآن (نقد + ذهب مخزون + سلعة مقوّمة بسعر الذهب) + قيمة شحن الذهب الموجود حالياً في دبي. رقم لحظي يعكس صافي ثروتك.
        </div>
      </div></div>`;
    m.classList.add('active');

};

/* ── أدوات الأدمين في ورقة التصفية: ضبط رصيد + إعادة تسمية ── */
window._adminFixDebt=(c)=>{
    const _inp=prompt('نوع الرصيد؟ اكتب أحد: دينار / سلعة / ذهب 24');
    let type=(_inp||'').trim();
    if(type==='سلعة'||type==='ذهب 705')type='دولار';     /* اسم العرض → اسم التخزين */
    if(!type||!['دينار','دولار','ذهب 730','ذهب 24'].includes(type))return toast('نوع غير صحيح — استعمل: دينار / سلعة / ذهب 24','error');
    const t=type;
    const cur=debts.filter(x=>x.c===c&&x.type===t).reduce((s,x)=>s+(x.a||0),0);
    const v=prompt(`الرصيد الحالي لـ${c} (${t}) = ${fmt(cur,2)}\nأدخل القيمة الهدف (موجب = يسالك، سالب = تسالو):`);
    if(v===null)return;
    const target=parseFloat(String(v).replace(',','.'))||0;
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    emitEvent('DEBT_FIX',{c,type:t,target},{op:{c,t:'ضبط رصيد',m:t,a:target,_ts:Date.now(),dt:nowStr,fixFrom:cur}});
    toast('🔧 ضُبط الرصيد','info'); try{_renderSettleRows();renderDebts();}catch(e){}
};
window._adminRenameCust=(c)=>{
    const to=prompt(`الاسم الجديد لـ«${c}» (سيُدمج معه إن وُجد):`);
    if(!to||!to.trim()||to.trim()===c)return;
    if(!confirm(`إعادة تسمية «${c}» → «${to.trim()}» على كل الدفاتر رجعياً؟`))return;
    emitEvent('CUST_RENAME',{from:c,to:to.trim()},null);
    toast('✏️ أُعيدت التسمية','info'); try{closeModal('settleModal');renderDebts();}catch(e){}
};

/* ── «وش درت هذا الشهر»: مبيعات دبي الشهرية بأسعار الأرشيف ── */
window.showDubaiMonth=(mKey)=>{
    const keys=new Set(); dubaiInvoices.forEach(d=>{const k=_mKeyOf(d.dt);if(k)keys.add(k);});
    const months=[...keys].sort().reverse();
    if(!months.length)return toast('لا مبيعات دبي بعد','info');
    const M=mKey||months[0];
    const list=dubaiInvoices.filter(d=>_mKeyOf(d.dt)===M);
    let totW=0,totUsd=0,totVal=0;
    const rows=list.map(d=>{
        const w=Number(d.w)||0, usd=Number(d.usd)||0;
        const r=_dubaiPerGram(d)||{pr:0,approx:true};
        const eq=w/0.730, val=eq*(r.pr||0);
        totW+=w; totUsd+=usd; totVal+=val;
        return `<div style="padding:.5rem .2rem;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between">
                <b style="font-size:.82rem">🏢 ${d.c||d.o||'—'}</b>
                <span style="font-size:.68rem;color:var(--t3)">${d.dt||''}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:.74rem;color:var(--t2);margin-top:.2rem">
                <span>${fmt(w,2)} غ · ${fmt(usd,2)} $</span>
                <span>⚖️ ${fmt(r.pr||0,0)} دج/غ${r.approx?'<span style="color:var(--t3)">*</span>':''}</span>
            </div>
            <div style="text-align:left;font-weight:900;color:#0f766e;font-size:.85rem">${fmt(val,0)} دج</div>
        </div>`;
    }).join('');
    const f0=n=>Math.round(n).toLocaleString('fr-FR');
    let m=document.getElementById('dubaiMonthModal');
    if(!m){m=document.createElement('div');m.id='dubaiMonthModal';m.className='modal-overlay';document.body.appendChild(m);}
    m.innerHTML=`<div class="modal-box" style="max-width:460px">
      <div class="modal-header"><h3 style="font-size:.95rem">🏙️ مبيعات دبي — الشهر</h3><button class="close-btn" onclick="closeModal('dubaiMonthModal')">✕</button></div>
      <div style="padding:.9rem;direction:rtl;text-align:right">
        <select onchange="showDubaiMonth(this.value)" style="width:100%;border:1px solid var(--border);border-radius:10px;padding:.5rem;font-family:inherit;background:var(--card2);color:var(--t);margin-bottom:.6rem">
          ${months.map(k=>`<option value="${k}" ${k===M?'selected':''}>${k.split('-')[1]} / ${k.split('-')[0]}</option>`).join('')}
        </select>
        <div class="infobox" style="margin-bottom:.55rem;font-size:.76rem">
            عدد: <b>${list.length}</b> · وزن: <b>${fmt(totW,2)} غ</b> · دولار: <b>${fmt(totUsd,2)} $</b><br>
            💰 القيمة بأسعار الأرشيف: <b style="color:#0f766e;font-size:.95rem">${f0(totVal)} دج</b>
        </div>
        <div style="max-height:48vh;overflow-y:auto">${rows||'<div style="text-align:center;color:var(--t3);padding:1rem">لا مبيعات هذا الشهر</div>'}</div>
        <div style="font-size:.64rem;color:var(--t3);margin-top:.5rem">⚖️ السعر بمعادلة الأرشيف (الشحن + الصرف المؤرَّخ + خصم المحلي). (*) تقريبي لنقص سعر الشحن/الذهب.</div>
      </div></div>`;
    m.classList.add('active');
};
