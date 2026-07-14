/* ═══════════ AUTH (متعدد المستخدمين) ═══════════ */
let _USERS_PATH='goldpro/_users';
let _usersCache={};

/* ── Firebase Email/Password Auth ──
   كل مستخدم يحصل على بريد افتراضي: username@goldpro.local
   هذا يضمن نفس الـ UID على كل الأجهزة بدل Anonymous الذي يعطي UID مختلف لكل جهاز */
const _FB_DOMAIN='@goldpro.local';
/* Firebase يشترط كلمة مرور ≥6 أحرف؛ نوسّع كلمة مرور المستخدم بلاحقة ثابتة لـ Firebase فقط.
   الأمان يبقى في كلمة المرور الأصلية (المهاجم يحتاجها أصلاً). كلمتك القصيرة تبقى كما هي في الدخول. */
const _FB_PW_SUFFIX='__GoldPro$ok';
const _fbPw=(pw)=>String(pw||'')+_FB_PW_SUFFIX;

async function _fbSignInEmail(uname,pw,allowCreate){
    const email=uname+_FB_DOMAIN;
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
    try{await firebase.auth().createUserWithEmailAndPassword(uname+_FB_DOMAIN,_fbPw(pw));}catch(e){}
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

async function _saveUser(uname,isAdmin=false){
    await _db.ref(`${_USERS_PATH}/${uname}`).set({isAdmin});
    _usersCache[uname]={isAdmin};
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
    try{ if(user.pwHash!==undefined) _saveUser(uname,!!user.isAdmin); }catch(e){}

    _encKey=pw;
    localStorage.setItem('gp12_ek',pw);
    const _isMobile=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if(!_isMobile&&document.documentElement.requestFullscreen&&!document.fullscreenElement)
        document.documentElement.requestFullscreen().catch(()=>{});
    _currentUser=uname;
    _LSKEY='gp12_'+(_SITE?_SITE+'_':'')+uname;
    _LSDRAFT='gp12_draft_'+(_SITE?_SITE+'_':'')+uname;
    _baseRef=_db.ref((_SITE?`goldpro/${_SITE}/`:'goldpro/')+uname+'/data');
    window._cfgRef=_db.ref((_SITE?`goldpro/${_SITE}/`:'goldpro/')+uname+'/cfg');
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
    await _saveUser(uname,true);
    _fbCreateAuthUser(uname,pw);
    document.getElementById('loginSetupPanel').style.display='none';
    document.getElementById('loginMainPanel').style.display='block';
    document.getElementById('loginUser').value=uname;
    document.getElementById('loginPw').value=pw;
    toast('✅ تم إنشاء الحساب — سيتم الدخول تلقائياً','success');
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
        const cred=firebase.auth.EmailAuthProvider.credential(_currentUser+_FB_DOMAIN,_fbPw(old));
        await _cu.reauthenticateWithCredential(cred);
    }catch(e){
        try{ const c2=firebase.auth.EmailAuthProvider.credential(_currentUser+_FB_DOMAIN,old); await _cu.reauthenticateWithCredential(c2); }
        catch(_){ return toast('كلمة المرور الحالية خاطئة','error'); }
    }
    try{ await _cu.updatePassword(_fbPw(n1)); }
    catch(e){ return toast('تعذّر تغيير كلمة المرور: '+(e.code||''),'error'); }
    await _saveUser(_currentUser,!!user.isAdmin);
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
        _baseRef=_db.ref((_SITE?`goldpro/${_SITE}/`:'goldpro/')+savedUser+'/data');
        window._cfgRef=_db.ref((_SITE?`goldpro/${_SITE}/`:'goldpro/')+savedUser+'/cfg');
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
const _SERIALS={
    'aff63724d67973681f4b2274fd723fd270b69bdd655c65700e4797429b99744d':'',
    'a4378c41b30faff270e9bb853650168a56aa9110bf00a35fb10072314659c5ad':'S2',
    '88b10f66cf0b46016ff518d0335b9ff969c55de520a92c8e5d8192c1f0fff336':'S3',
};

async function _snHash(s){
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function _applySite(site){
    _SITE=site||'';
    _USERS_PATH=_SITE?`goldpro/${_SITE}/_users`:'goldpro/_users';
}
async function _checkSerial(){
    const stored=localStorage.getItem(_SN_LS);
    if(stored){
        const sep=stored.lastIndexOf(':');
        const hash=stored.slice(0,sep);
        const site=stored.slice(sep+1);
        if(hash in _SERIALS && _SERIALS[hash]===(site||'')){
            _applySite(site);
            /* السيريال صالح — أزل الـ overlay (أو أخفه إن كان مخفياً أصلاً) */
            const ov=document.getElementById('serialOverlay');
            if(ov)ov.remove();
            _checkAuth();return;
        }
        /* هاش مخزّن لكنه غير صالح — احذفه وأظهر الشاشة */
        localStorage.removeItem(_SN_LS);
    }
    /* لا سيريال مخزّن — أظهر الشاشة وانتظر الإدخال */
    const ov=document.getElementById('serialOverlay');
    if(ov)ov.style.display='flex';
    setTimeout(()=>{const e=document.getElementById('serialInput');if(e)e.focus();},200);
}
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
    if(!(h in _SERIALS))return _showSerialError('❌ رمز التفعيل غير صحيح');
    const site=_SERIALS[h];
    localStorage.setItem(_SN_LS, h+':'+(site||''));
    sessionStorage.removeItem('gp12_auth');localStorage.removeItem('gp12_auth');
    sessionStorage.removeItem('gp12_user');localStorage.removeItem('gp12_user');
    if(window._cfgRef){try{window._cfgRef.child('goodsNames').off();window._cfgRef.child('custPhones').off();}catch(e){} window._cfgRef=null;}
    window._goodsNames=[];window._portalCust={};
    try{localStorage.removeItem('gp12_goodsNames');localStorage.removeItem('gp12_portalCust');}catch(e){}
    _applySite(site);
    const ov=document.getElementById('serialOverlay');
    ov.classList.add('fade-out');
    setTimeout(()=>{ov.remove();_checkAuth();},520);
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
