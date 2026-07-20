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

    /* المستخدم قد لا يكون ظهر في _users بعد (تأخّر القاعدة عقب الإنشاء) — اقبله من الكاش */
    const user=users[uname]||_usersCache[uname];
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
    /* أعد كتابة سجل المستخدم إن تعذّر أثناء الإنشاء (تأخّر رمز المصادقة) */
    if(window._pendingUserWrite===uname){
        _saveUser(uname,true).then(()=>{window._pendingUserWrite=null;}).catch(()=>{});
    }
    /* 💾 نسخة احتياطية تلقائية كل 12 ساعة (للأدمن — وكل مستخدم أدمن مساحته) */
    try{ if(window._startAutoBackup)window._startAutoBackup(); }catch(e){}
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
        /* فحص السريال قد يكون سجّل دخولاً مجهولاً — نُنهيه أولاً كي لا يعيق الإنشاء */
        const _cu=firebase.auth().currentUser;
        if(_cu&&_cu.isAnonymous){ try{await firebase.auth().signOut();}catch(_){} }
        await firebase.auth().createUserWithEmailAndPassword(_authEmail(uname),_fbPw(pw));
        created=true;
    }catch(e){
        const code=(e&&e.code)||'';
        if(code==='auth/email-already-in-use')
            return toast(`🚫 الاسم «${uname}» محجوز — اختر اسماً آخر`,'error');
        if(code==='auth/operation-not-allowed')
            return toast('⚠️ فعّل Email/Password في Firebase Console ← Authentication','error');
        if(code==='auth/weak-password')
            return toast('كلمة المرور ضعيفة — 6 أحرف على الأقل','error');
        if(code==='auth/network-request-failed')
            return toast('لا يوجد اتصال بالإنترنت — حاول ثانيةً','error');
        if(code==='auth/invalid-email')
            return toast('الاسم يحتوي رموزاً غير مقبولة — أحرف لاتينية وأرقام فقط','error');
        return toast('تعذّر إنشاء الحساب: '+(code||e&&e.message||'خطأ غير معروف'),'error');
    }

    /* ⏳ انتظر استقرار جلسة المصادقة — القاعدة تتحقق من auth.token.email،
       والكتابة الفورية قبل استقرار الرمز تُرفض بصمت فيبدو أن الحساب لم يُنشأ. */
    await new Promise(res=>{
        const _cur=firebase.auth().currentUser;
        if(_cur&&_cur.email){res();return;}
        let done=false;
        const off=firebase.auth().onAuthStateChanged(u=>{
            if(u&&u.email&&!done){done=true;off();res();}
        });
        setTimeout(()=>{ if(!done){done=true;try{off();}catch(_){}res();} },5000);
    });
    try{ await firebase.auth().currentUser?.getIdToken(true); }catch(_){}

    /* 🔐 مطالبة السريال: تُكتب مرة واحدة فقط (القاعدة تمنع تغييرها لاحقاً) */
    if(window._snHashCur&&!window._snOwner){
        try{
            await firebase.database().ref('goldpro/_serials/'+window._snHashCur+'/owner').set(uname);
            window._snOwner=uname;
            try{localStorage.setItem('gp12_sn_own',JSON.stringify({h:window._snHashCur,owner:uname,name:window._snName||''}));}catch(_){}
        }catch(e){
            /* سبقه غيره للمطالبة؟ */
            const r=await _fetchSerial(window._snHashCur);
            if(r&&r.owner&&r.owner!==uname)return toast(`🚫 هذا الرمز صار مربوطاً بمحل «${r.owner}»`,'error');
            /* غير ذلك (تأخّر رمز المصادقة) — نتابع، وتُعاد المحاولة بعد الدخول */
            window._snOwner=uname;
            try{localStorage.setItem('gp12_sn_own',JSON.stringify({h:window._snHashCur,owner:uname,name:window._snName||''}));}catch(_){}
        }
    }

    /* سجّل المستخدم — لا نُفشل الدخول لو تأخّرت القاعدة (يُعاد بعد الدخول) */
    try{ await _saveUser(uname,true); }
    catch(e){ _usersCache[uname]={isAdmin:true}; window._pendingUserWrite=uname; }
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
    /* 🔒 حارس أمني: الجلسة المحفوظة يجب أن تخصّ مالك السريال المفعَّل على هذا الجهاز.
       لو نُسخت جلسة الأدمن ضمن التطبيق الموزَّع، أو اختلف المالك، تُمسح الجلسة فوراً
       فلا يرى أي زبون بيانات مالك آخر ولو للحظة. */
    const _owner=window._snOwner||'';
    if(savedUser && _owner && savedUser.toLowerCase()!==_owner.toLowerCase()){
        ['gp12_auth','gp12_user','gp12_ek','gp12_role'].forEach(k=>{
            try{localStorage.removeItem(k);sessionStorage.removeItem(k);}catch(e){}
        });
        _currentUser='';_encKey='';
        const _ov=document.getElementById('loginOverlay'); if(_ov)_ov.classList.add('show');
        if(window._applySerialLock)window._applySerialLock();
        return;
    }
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
/* 🔒 السريالات مدمجة في التطبيق — تعمل بلا إنترنت وبلا أي عمل في Console.
   القيمة = اسم المحل للعرض. الهاش SHA-256 لا يكشف الرمز.
   الربط بالمالك (سريال واحد = محل واحد) يُحفظ في Firebase تلقائياً أول تفعيل. */
const _SERIALS={
    /* سريالاتك القديمة — تبقى صالحة */
    'aff63724d67973681f4b2274fd723fd270b69bdd655c65700e4797429b99744d':'',
    'a4378c41b30faff270e9bb853650168a56aa9110bf00a35fb10072314659c5ad':'S2',
    '88b10f66cf0b46016ff518d0335b9ff969c55de520a92c8e5d8192c1f0fff336':'S3',
    /* ═══ 10 سريالات للتوزيع ═══ */
    '61f5d9e15a15337d79363cb53e23da624ad7d07575e9724ee7c4c3b90915f311':'محل 1',
    'a7dafdccb9793339ec3e4af429e4a08342f70f567a5632f266483862085e816a':'محل 2',
    'ff0abc4fb360b6c734f3bb09ee10926d15582aeee4af7f7a9bc7366c9d5825a5':'محل 3',
    'c896a5e703f4cfb452a0058173d14a656ec46c8de1d2e32237bdeae412a0d542':'محل 4',
    '2ca1024cb2ec68aebf2df05eb720d305d95d332ab032d245b7df109e504cdcc9':'محل 5',
    '90418bba315f4c83421b8c4645c7d40a6413fc075003b18906e7d14839e3a88e':'محل 6',
    'fac4b291957a5da306ee8ca6d64b52b861f1b03ecd39301f3516d8e494ce8357':'محل 7',
    'b47b612f7332e6041f20eac2ac57b3c2bb7d1bb341c10a56eca3ad4deeccc4b6':'محل 8',
    'f2b47d01f87d2d496397e167895e78b7c1846d919bc680de33b6b82f48c1dcc6':'محل 9',
    '329709f726a3213e9ea62a00ec376cc95a068e8002902fb5d682f7551863e6aa':'محل 10',
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
        /* ① مدمج → صالح فوراً · لكن اقرأ المالك أولاً كي يعمل حارس الجلسة */
        const builtinOk=(hash in _SERIALS && _SERIALS[hash]===(site||''));
        if(builtinOk){
            /* استعد المالك من الكاش قبل _checkAuth (وإلا رأى الزبون جلسة أدمن أخرى) */
            try{const o=JSON.parse(localStorage.getItem('gp12_sn_own')||'null');
                if(o&&o.h===hash){window._snHashCur=o.h;window._snOwner=o.owner||'';window._snName=o.name||'';}
                else{window._snHashCur=hash;}
            }catch(e){window._snHashCur=hash;}
            _applySite(site);
            const ov=document.getElementById('serialOverlay');
            if(ov)ov.remove();
            _checkAuth();
            /* تحقّق من المالك في الخلفية (السريالات المدمجة تُطالَب أيضاً) */
            _fetchSerial(hash).then(r=>{
                if(r===undefined)return;
                if(r.revoked){ localStorage.removeItem(_SN_LS);try{localStorage.removeItem('gp12_sn_own');}catch(e){}
                    alert('⚠️ رمز التفعيل موقوف — تواصل مع المزوّد');location.reload();return; }
                window._snOwner=r.owner||''; window._snName=r.name||_SERIALS[hash]||'';
                try{localStorage.setItem('gp12_sn_own',JSON.stringify({h:hash,owner:window._snOwner,name:window._snName}));}catch(e){}
                if(window._applySerialLock)window._applySerialLock();
            });
            return;
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
        /* سريال مدمج: صالح فوراً بلا إنترنت · نقرأ مالكه من السحابة إن وُجد */
        site='';
        _label=_SERIALS[h]||'';
        _showSerialError('⏳ جارٍ التحقق…');
        const r=await _fetchSerial(h);
        if(r&&r.owner)_owner=r.owner;                   /* مطالَب به سابقاً */
        if(r&&r.name)_label=r.name;
        if(r&&r.revoked)return _showSerialError('❌ رمز التفعيل موقوف — تواصل مع المزوّد');
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
/* 🧹 حارس التوزيع: أي نسخة موزَّعة قد تحمل جلسة الأدمن (لو بُنيت وهو داخل).
   عند أول تشغيل على جهاز جديد — قبل تفعيل أي سريال — نمسح أي جلسة موروثة
   فلا يرى المشتري/الزبون بيانات المطوّر ولو للحظة. */
(function _purgeInheritedSession(){
    try{
        const hasSerial=!!localStorage.getItem(_SN_LS);
        const firstRunDone=localStorage.getItem('gp12_device_init')==='1';
        if(!hasSerial && !firstRunDone){
            ['gp12_auth','gp12_user','gp12_ek','gp12_role','gp12_sn_own'].forEach(k=>{
                try{localStorage.removeItem(k);sessionStorage.removeItem(k);}catch(e){}
            });
            localStorage.setItem('gp12_device_init','1');
        }
    }catch(e){}
})();
window.onload=()=>{ _authReadyPromise.then(()=>_checkSerial()); };
