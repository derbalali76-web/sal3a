/* ═══════════ AUTH (متعدد المستخدمين) ═══════════ */
let _USERS_PATH='goldpro/_users';
let _usersCache={};

/* ── Firebase Email/Password Auth ──
   كل مستخدم يحصل على بريد افتراضي: username@goldpro.local
   هذا يضمن نفس الـ UID على كل الأجهزة بدل Anonymous الذي يعطي UID مختلف لكل جهاز */
const _FB_DOMAIN='@goldpro.local';
/* 🔑 كل مستخدم = محل مستقل بذاته (هو أدمن نفسه وله زبائنه).
   لا طبقة «موقع» في المسارات — اسم المستخدم فريد عالمياً بحكم Firebase Auth،
   فلا تصادم ممكن: من يسجّل الاسم أولاً يملكه. */
function _authEmail(uname){
    return String(uname||'').toLowerCase()+_FB_DOMAIN;
}
window._authEmail=_authEmail;
/* Firebase يشترط كلمة مرور ≥6 أحرف؛ نوسّع كلمة مرور المستخدم بلاحقة ثابتة لـ Firebase فقط.
   الأمان يبقى في كلمة المرور الأصلية (المهاجم يحتاجها أصلاً). كلمتك القصيرة تبقى كما هي في الدخول. */
const _FB_PW_SUFFIX='__GoldPro$ok';
const _fbPw=(pw)=>String(pw||'')+_FB_PW_SUFFIX;

async function _fbSignInEmail(uname,pw,allowCreate){
    const email=_authEmail(uname);
    try{
        await firebase.auth().signInWithEmailAndPassword(email,_fbPw(pw));
        return true;
    }catch(e){
        /* حسابات قديمة أُنشئت بكلمة المرور الخام قبل التوسيع */
        try{ await firebase.auth().signInWithEmailAndPassword(email,pw); return true; }catch(_){}
        /* مستخدم معروف فقد حسابه (حُذف) → أعِد إنشاءه بكلمة مروره */
        if(allowCreate){
            try{ await firebase.auth().createUserWithEmailAndPassword(email,_fbPw(pw)); return true; }catch(_){}
        }
        return false;
    }
}

async function _fbCreateAuthUser(uname,pw){
    try{await firebase.auth().createUserWithEmailAndPassword(_authEmail(uname),_fbPw(pw));}catch(e){}
}

async function _hashPw(pw){
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pw));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* _loadUsers مع Timeout 5 ثوانٍ + fallback إلى الكاش لحل مشكلة التجميد أوفلاين */
function _loadUsers(){
    if(Object.keys(_usersCache).length)return Promise.resolve(_usersCache);
    return new Promise(res=>{
        const t=setTimeout(()=>res(_usersCache),5000);
        _db.ref(_USERS_PATH).once('value',snap=>{
            clearTimeout(t);
            _usersCache=snap.val()||{};
            res(_usersCache);
        });
    });
}

async function _saveUser(uname,isAdmin=true){
    /* كل مستخدم أدمن على مساحته الخاصة */
    await _db.ref(`${_USERS_PATH}/${uname}`).set({isAdmin:true});
    _usersCache[uname]={isAdmin:true};
}

/* تهيئة التطبيق بعد الدخول */
function _afterLogin(){
    initRafTable();
    /* حمّل بيانات هذا المستخدم المحليّة (ترباح/حاسبة دبي) بمفتاحه الخاص */
    try{ if(typeof _loadTarbah==='function')_loadTarbah(); }catch(e){}
    try{ if(typeof _loadDubaiCalc==='function')_loadDubaiCalc(); }catch(e){}
    load();syncBal();updAll();
    invRows=10;initInvTable();
    try{
        const _dr=_lsGet(_LSDRAFT);
        if(_dr?.rows?.length>invRows){_dr.rows=_dr.rows.slice(0,invRows);_lsSet(_LSDRAFT,_dr);}
    }catch(e){}
    restoreDraft();calcRaf();
    setInterval(save,30000);
    _startAutoBackup();
    fetchSpotPrice();setInterval(fetchSpotPrice,30*1000);
    /* إن فُتح ملف .gpdf قبل توفّر مفتاح المستخدم، عالجه الآن */
    try{ if(typeof _processPendingGpdf==='function') setTimeout(_processPendingGpdf,400); }catch(e){}
}

function _showLoginErr(msg){
    const el=document.getElementById('loginErr');
    el.textContent='❌ '+msg;el.style.display='block';
    el.style.animation='none';requestAnimationFrame(()=>{el.style.animation='';});
}

async function doLogin(){
    const rawUser=(document.getElementById('loginUser').value||'').trim();
    const uname=rawUser.toLowerCase();
    const pw=document.getElementById('loginPw').value;
    document.getElementById('loginErr').style.display='none';
    if(!rawUser)return _showLoginErr('أدخل اسم المستخدم');
    if(!pw)return _showLoginErr('أدخل كلمة المرور');

    /* 👤 توجيه الزبون: إذا كان الحقل رقم هاتف (أرقام فقط، 8+ خانات) جرّب بوابة كشف الحساب أولاً */
    const _digits=rawUser.replace(/[^0-9]/g,'');
    if(_digits.length>=8 && /^[0-9+\s]+$/.test(rawUser)){
        const _ok=await (window._tryCustomerPortal?window._tryCustomerPortal(_digits,pw):Promise.resolve(false));
        if(_ok)return; /* دخل الزبون بنجاح */
        /* إن فشل، نكمل كمحاولة مستخدم عادي (قد يكون اسم مستخدم رقمي) */
    }

    /* مؤشر التحميل أثناء التحقق */
    const btn=document.querySelector('#loginMainPanel .login-btn');
    const origTxt=btn?btn.textContent:'';
    if(btn){btn.disabled=true;btn.textContent='⏳ جاري التحقق...';}

    let users;
    try{users=await _loadUsers();}catch(e){users=_usersCache;}

    const user=users[uname];
    if(!user){ if(btn){btn.disabled=false;btn.textContent=origTxt;} return _showLoginErr('اسم المستخدم غير موجود'); }

    /* التحقّق من كلمة المرور عبر مصادقة Firebase حصراً (لا بصمة مخزّنة تُكسَر) */
    const _ok=await _fbSignInEmail(uname,pw,true);
    if(btn){btn.disabled=false;btn.textContent=origTxt;}
    if(!_ok)return _showLoginErr('كلمة المرور خاطئة');
    /* نظّف أي بصمة قديمة متبقّية في _users */
    try{ if(user.pwHash!==undefined) _saveUser(uname,true); }catch(e){}

    _encKey=pw;
    localStorage.setItem('gp12_ek',pw);
    const _isMobile=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if(!_isMobile&&document.documentElement.requestFullscreen&&!document.fullscreenElement)
        document.documentElement.requestFullscreen().catch(()=>{});
    _currentUser=uname;
    _LSKEY='gp12_'+(_SITE?_SITE+'_':'')+uname;
    _LSDRAFT='gp12_draft_'+(_SITE?_SITE+'_':'')+uname;
    _baseRef=_db.ref('goldpro/'+uname+'/data');
    window._cfgRef=_db.ref('goldpro/'+uname+'/cfg');
    if(window._attachUserCfg)window._attachUserCfg();
    localStorage.setItem('gp12_auth','1');localStorage.setItem('gp12_user',uname);
    const ud=document.getElementById('currentUserDisplay');if(ud)ud.textContent=uname;
    const ov=document.getElementById('loginOverlay');
    ov.classList.add('fade-out');setTimeout(()=>ov.remove(),520);
    _fbInitialLoad();_afterLogin();
}

async function setupFirstUser(){
    const uname=(document.getElementById('setupUser').value||'').trim().toLowerCase();
    const pw=document.getElementById('setupPw').value;
    const pw2=document.getElementById('setupPw2').value;
    if(!uname||uname.length<3)return toast('اسم المستخدم ضعيف (3 أحرف على الأقل)','error');
    if(!/^[a-z0-9_]+$/.test(uname))return toast('أحرف لاتينية وأرقام فقط بدون مسافة','error');
    if(pw.length<4)return toast('كلمة المرور قصيرة (4 أحرف على الأقل)','error');
    if(pw!==pw2)return toast('كلمتا المرور لا تتطابقان','error');

    /* 🔒 سريال مربوط بمحل آخر؟ */
    if(window._snOwner&&window._snOwner!==uname)
        return toast(`🚫 هذا الرمز مربوط بمحل «${window._snOwner}» — ادخل بكلمة مروره`,'error');

    /* الاسم محجوز عالمياً؟ (Firebase Auth يفرض التفرّد) */
    let created=false;
    try{
        await firebase.auth().createUserWithEmailAndPassword(_authEmail(uname),_fbPw(pw));
        created=true;
    }catch(e){
        if(e&&e.code==='auth/email-already-in-use')
            return toast(`🚫 الاسم «${uname}» محجوز — اختر اسماً آخر`,'error');
        return toast('تعذّر إنشاء الحساب — تأكد من الإنترنت','error');
    }

    /* 🔐 مطالبة السريال: تُكتب مرة واحدة فقط (القاعدة تمنع تغييرها لاحقاً) */
    if(window._snHashCur&&!window._snOwner){
        try{
            await firebase.database().ref('goldpro/_serials/'+window._snHashCur+'/owner').set(uname);
            window._snOwner=uname;
            try{localStorage.setItem('gp12_sn_own',JSON.stringify({h:window._snHashCur,owner:uname,name:window._snName||''}));}catch(_){}
        }catch(e){
            /* سبقه غيره للمطالبة */
            const r=await _fetchSerial(window._snHashCur);
            if(r&&r.owner)return toast(`🚫 هذا الرمز صار مربوطاً بمحل «${r.owner}»`,'error');
            return toast('تعذّر ربط الرمز — حاول ثانيةً','error');
        }
    }

    await _saveUser(uname,true);
    document.getElementById('loginSetupPanel').style.display='none';
    document.getElementById('loginMainPanel').style.display='block';
    document.getElementById('loginUser').value=uname;
    document.getElementById('loginPw').value=pw;
    toast('✅ تم إنشاء محلك — سيتم الدخول تلقائياً','success');
    setTimeout(doLogin,600);
}

function doLogout(){
    if(!confirm('هل تريد تسجيل الخروج؟'))return;
    _encKey='';
    sessionStorage.removeItem('gp12_auth');localStorage.removeItem('gp12_auth');
    sessionStorage.removeItem('gp12_user');localStorage.removeItem('gp12_user');
    if(window._cfgRef){try{window._cfgRef.child('goodsNames').off();window._cfgRef.child('custPhones').off();}catch(e){} window._cfgRef=null;}
    window._goodsNames=[];window._portalCust={};
    try{localStorage.removeItem('gp12_goodsNames');localStorage.removeItem('gp12_portalCust');}catch(e){}
    sessionStorage.removeItem('gp12_ek');localStorage.removeItem('gp12_ek');
    location.reload();
}

async function changePw(){
    const old=document.getElementById('pwOld').value;
    const n1=document.getElementById('pwNew1').value;
    const n2=document.getElementById('pwNew2').value;
    const user=_usersCache[_currentUser];
    if(!user)return toast('خطأ: المستخدم غير موجود','error');
    if(!n1||n1!==n2)return toast('كلمتا المرور الجديدتان لا تتطابقان','error');
    if(n1.length<4)return toast('كلمة المرور قصيرة — 4 أحرف على الأقل','error');
    const _cu=firebase.auth().currentUser;
    if(!_cu)return toast('سجّل الدخول أولاً','error');
    /* تحقّق من كلمة المرور الحالية عبر Firebase (لا بصمة مخزّنة) */
    try{
        const cred=firebase.auth.EmailAuthProvider.credential(_authEmail(_currentUser),_fbPw(old));
        await _cu.reauthenticateWithCredential(cred);
    }catch(e){
        try{ const c2=firebase.auth.EmailAuthProvider.credential(_authEmail(_currentUser),old); await _cu.reauthenticateWithCredential(c2); }
        catch(_){ return toast('كلمة المرور الحالية خاطئة','error'); }
    }
    try{ await _cu.updatePassword(_fbPw(n1)); }
    catch(e){ return toast('تعذّر تغيير كلمة المرور: '+(e.code||''),'error'); }
    await _saveUser(_currentUser,true);
    _encKey=n1;
    localStorage.setItem('gp12_ek',n1);
    save();
    document.getElementById('pwOld').value='';document.getElementById('pwNew1').value='';document.getElementById('pwNew2').value='';
    toast('✅ تم تغيير كلمة المرور','success');
}

async function addUser(){
    const uname=(document.getElementById('newUserName').value||'').trim().toLowerCase();
    const pw=document.getElementById('newUserPw').value;
    if(!uname||uname.length<3)return toast('اسم المستخدم ضعيف','error');
    if(!/^[a-z0-9_]+$/.test(uname))return toast('أحرف لاتينية وأرقام فقط','error');
    if(pw.length<4)return toast('كلمة المرور قصيرة','error');
    if(_usersCache[uname])return toast('⚠️ المستخدم موجود مسبقاً','error');
    await _saveUser(uname,false);
    _fbCreateAuthUser(uname,pw);
    document.getElementById('newUserName').value='';document.getElementById('newUserPw').value='';
    toast('✅ تم إنشاء المستخدم: '+uname,'success');
    renderUsersList();
}

async function deleteUser(uname){
    if(!confirm(`حذف المستخدم "${uname}"؟`))return;
    await _db.ref(`${_USERS_PATH}/${uname}`).remove();
    delete _usersCache[uname];
    toast('✅ تم الحذف','success');renderUsersList();
}

function renderUsersList(){
    const ul=document.getElementById('usersList');if(!ul)return;
    const isAdmin=_usersCache[_currentUser]?.isAdmin;
    ul.innerHTML=Object.keys(_usersCache).map(u=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .6rem;background:var(--card2);border-radius:8px;margin-bottom:.25rem;border:1px solid var(--border)">
            <span style="font-size:.78rem;font-weight:800">${u}${_usersCache[u].isAdmin?' 👑':''}</span>
            ${isAdmin&&u!==_currentUser?`<button onclick="deleteUser('${u}')" style="border:none;background:transparent;color:var(--rd);cursor:pointer;font-size:.82rem;padding:0">🗑️</button>`:''}
        </div>`).join('');
}

async function _checkAuth(){
    const savedUser=localStorage.getItem('gp12_user')||sessionStorage.getItem('gp12_user');
    if((localStorage.getItem('gp12_auth')==='1'||sessionStorage.getItem('gp12_auth')==='1')&&savedUser){
        _encKey=localStorage.getItem('gp12_ek')||sessionStorage.getItem('gp12_ek')||'';
        _currentUser=savedUser;
        _LSKEY='gp12_'+(_SITE?_SITE+'_':'')+savedUser;
        _LSDRAFT='gp12_draft_'+(_SITE?_SITE+'_':'')+savedUser;
        _baseRef=_db.ref('goldpro/'+savedUser+'/data');
        window._cfgRef=_db.ref('goldpro/'+savedUser+'/cfg');
        if(window._attachUserCfg)window._attachUserCfg();
        const ud=document.getElementById('currentUserDisplay');if(ud)ud.textContent=savedUser;
        document.getElementById('loginOverlay').remove();
        _loadUsers().catch(()=>{});
        /* انتظر اكتمال Firebase Auth قبل تحميل البيانات */
        if(_encKey) await _fbSignInEmail(savedUser,_encKey).catch(()=>{});
        _fbInitialLoad();_afterLogin();return;
    }
    /* لا جلسة محفوظة → أظهر شاشة الدخول (كانت مخفية لمنع الوميض) */
    const _ov=document.getElementById('loginOverlay'); if(_ov)_ov.classList.add('show');
    /* 🔒 السريال يقرر: مالك موجود → دخول بكلمة المرور · بلا مالك → إنشاء محل */
    if(window._snHashCur){
        try{await _loadUsers();}catch(e){}
        if(window._applySerialLock)window._applySerialLock();
        return;
    }
    let users;
    try{users=await _loadUsers();}catch(e){users={};}
    if(Object.keys(users).length===0){
        /* أوفلاين أو لا يوجد مستخدمون بعد */
        if(!_fbOnline){
            /* لا نعرف الحالة — أظهر لوحة الدخول وانتظر */
            setTimeout(()=>{const e=document.getElementById('loginUser');if(e)e.focus();},200);
        }else{
            /* متصل وفعلاً لا يوجد مستخدمون → أنشئ أول حساب */
            document.getElementById('loginMainPanel').style.display='none';
            document.getElementById('loginSetupPanel').style.display='flex';
            setTimeout(()=>{const e=document.getElementById('setupUser');if(e)e.focus();},200);
        }
    }else{
        setTimeout(()=>{const e=document.getElementById('loginUser');if(e)e.focus();},200);
    }
}

/* ═══════════ SERIAL NUMBER (حماية النسخة) ═══════════ */
const _SN_LS='gp12_sn';
/* 🔒 سريالات احتياطية مدمجة (تعمل بلا إنترنت وبلا Console) — تبقى صالحة دائماً */
const _SERIALS={
    'aff63724d67973681f4b2274fd723fd270b69bdd655c65700e4797429b99744d':'',
    'a4378c41b30faff270e9bb853650168a56aa9110bf00a35fb10072314659c5ad':'S2',
    '88b10f66cf0b46016ff518d0335b9ff969c55de520a92c8e5d8192c1f0fff336':'S3',
};
/* 🌐 سريالات Firebase: goldpro/_serials/{sha256} = {site, name, active}
   لا يمكن سردها — تُقرأ بالهاش فقط (من يعرف السريال فقط يصل لعقدته). */
async function _fetchSerial(hash){
    try{
        const snap=await Promise.race([
            firebase.database().ref('goldpro/_serials/'+hash).once('value'),
            new Promise((_,rj)=>setTimeout(()=>rj(new Error('timeout')),6000))
        ]);
        const v=snap.val();
        if(!v)return null;
        if(v.active===false)return {revoked:true};
        return {site:v.site||'',name:v.name||'',owner:v.owner||''};
    }catch(e){ return undefined; } /* undefined = تعذّر الوصول (لا نُبطل) */
}

async function _snHash(s){
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function _applySite(site){
    _SITE=site||'';
    _USERS_PATH='goldpro/_users'; /* سجل أسماء عالمي — العزل بالمستخدم لا بالموقع */
}
async function _checkSerial(){
    const stored=localStorage.getItem(_SN_LS);
    if(stored){
        const sep=stored.lastIndexOf(':');
        const hash=stored.slice(0,sep);
        const site=stored.slice(sep+1);
        /* ① مدمج → صالح فوراً */
        const builtinOk=(hash in _SERIALS && _SERIALS[hash]===(site||''));
        if(builtinOk){
            _applySite(site);
            const ov=document.getElementById('serialOverlay');
            if(ov)ov.remove();
            _checkAuth();return;
        }
        /* ② مفعَّل سابقاً من Firebase → نثق بالكاش فوراً (يعمل أوفلاين)
              ثم نتحقّق في الخلفية: إن أُلغي السريال نُخرج المستخدم */
        try{const o=JSON.parse(localStorage.getItem('gp12_sn_own')||'null');
            if(o&&o.h===hash){window._snHashCur=o.h;window._snOwner=o.owner||'';window._snName=o.name||'';}}catch(e){}
        _applySite(site);
        const ov=document.getElementById('serialOverlay');
        if(ov)ov.remove();
        _checkAuth();
        _fetchSerial(hash).then(r=>{
            if(r===undefined)return;                    /* لا إنترنت — لا نُبطل */
            if(!r||r.revoked||(r.site||'')!==(site||'')){
                localStorage.removeItem(_SN_LS);
                try{localStorage.removeItem('gp12_sn_own');}catch(e){}
                alert('⚠️ رمز التفعيل لم يعد صالحاً — تواصل مع المزوّد');
                location.reload();
            }else{
                /* حدّث المالك (قد يكون طُولب من جهاز آخر) */
                window._snOwner=r.owner||''; window._snName=r.name||'';
                try{localStorage.setItem('gp12_sn_own',JSON.stringify({h:hash,owner:window._snOwner,name:window._snName}));}catch(e){}
                if(window._applySerialLock)window._applySerialLock();
            }
        });
        return;
    }
    /* لا سيريال مخزّن — أظهر الشاشة وانتظر الإدخال */
    const ov=document.getElementById('serialOverlay');
    if(ov)ov.style.display='flex';
    setTimeout(()=>{const e=document.getElementById('serialInput');if(e)e.focus();},200);
}
/* 🔒 سريال واحد = محل واحد: بعد المطالبة يُقفل اسم الحساب على المالك */
window._applySerialLock=()=>{
    const owner=window._snOwner||'';
    const setupP=document.getElementById('loginSetupPanel');
    const mainP=document.getElementById('loginMainPanel');
    const uEl=document.getElementById('loginUser');
    const hint=document.getElementById('loginShopHint');
    if(owner){
        /* مطالَب به → الدخول باسم المالك فقط (كلمة المرور وحدها) */
        if(setupP)setupP.style.display='none';
        if(mainP)mainP.style.display='block';
        if(uEl){
            uEl.value=owner; uEl.readOnly=true;
            uEl.style.opacity='.75'; uEl.style.cursor='not-allowed';
        }
        if(hint){
            hint.innerHTML=`🏪 <strong>${window._snName||owner}</strong> — أدخل كلمة المرور`;
            hint.style.display='block';
        }
        const pEl=document.getElementById('loginPw'); if(pEl)setTimeout(()=>pEl.focus(),250);
    }else if(window._snHashCur){
        /* سريال جديد بلا مالك → أول تفعيل: اختر اسم المحل */
        if(setupP)setupP.style.display='block';
        if(mainP)mainP.style.display='none';
        const sh=document.getElementById('setupShopHint');
        if(sh){
            sh.innerHTML=`🎉 أول تفعيل${window._snName?` لـ <strong>${window._snName}</strong>`:''} — اختر اسم محلك وكلمة مرورك<br><small style="color:#f59e0b">⚠️ الاسم يُقفل نهائياً بعد الحفظ</small>`;
            sh.style.display='block';
        }
    }
};
function _showSerialError(msg){
    const el=document.getElementById('serialErr');
    if(!el)return;
    el.textContent=msg;el.style.display='block';
    el.style.animation='none';requestAnimationFrame(()=>{el.style.animation='';});
}
async function activateSerial(){
    const entered=(document.getElementById('serialInput').value||'').trim().toUpperCase();
    if(!entered)return _showSerialError('❌ أدخل رمز التفعيل');
    document.getElementById('serialErr').style.display='none';
    const h=await _snHash(entered);
    let site,_owner='',_label='';
    if(h in _SERIALS){
        site=_SERIALS[h];                               /* سريال مدمج — بلا ربط */
    }else{
        _showSerialError('⏳ جارٍ التحقق…');
        const r=await _fetchSerial(h);                  /* سريال من Firebase */
        if(r===undefined)return _showSerialError('❌ تعذّر التحقق — تأكد من الإنترنت');
        if(!r)return _showSerialError('❌ رمز التفعيل غير صحيح');
        if(r.revoked)return _showSerialError('❌ رمز التفعيل موقوف — تواصل مع المزوّد');
        site=r.site||''; _owner=r.owner||''; _label=r.name||'';
    }
    localStorage.setItem(_SN_LS, h+':'+(site||''));
    window._snHashCur=h;
    window._snOwner=_owner||'';
    window._snName=_label||'';
    try{localStorage.setItem('gp12_sn_own',JSON.stringify({h,owner:window._snOwner,name:window._snName}));}catch(e){}
    sessionStorage.removeItem('gp12_auth');localStorage.removeItem('gp12_auth');
    sessionStorage.removeItem('gp12_user');localStorage.removeItem('gp12_user');
    if(window._cfgRef){try{window._cfgRef.child('goodsNames').off();window._cfgRef.child('custPhones').off();}catch(e){} window._cfgRef=null;}
    window._goodsNames=[];window._portalCust={};
    try{localStorage.removeItem('gp12_goodsNames');localStorage.removeItem('gp12_portalCust');}catch(e){}
    _applySite(site);
    const ov=document.getElementById('serialOverlay');
    ov.classList.add('fade-out');
    setTimeout(()=>{ov.remove();_checkAuth();if(window._applySerialLock)window._applySerialLock();},520);
}

window._changeSN=function(){
    if(!confirm('هل تريد تغيير رمز التفعيل؟\nسيتم تسجيل الخروج من الحساب الحالي.'))return;
    localStorage.removeItem(_SN_LS);
    sessionStorage.removeItem('gp12_auth');localStorage.removeItem('gp12_auth');
    sessionStorage.removeItem('gp12_user');localStorage.removeItem('gp12_user');
    if(window._cfgRef){try{window._cfgRef.child('goodsNames').off();window._cfgRef.child('custPhones').off();}catch(e){} window._cfgRef=null;}
    window._goodsNames=[];window._portalCust={};
    try{localStorage.removeItem('gp12_goodsNames');localStorage.removeItem('gp12_portalCust');}catch(e){}
    location.reload();
};

window.doLogin=doLogin;window.changePw=changePw;window.doLogout=doLogout;
window.setupFirstUser=setupFirstUser;window.addUser=addUser;
window.activateSerial=activateSerial;
window.deleteUser=deleteUser;window.renderUsersList=renderUsersList;
window.onload=()=>{ _authReadyPromise.then(()=>_checkSerial()); };
