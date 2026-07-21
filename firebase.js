/* ═══════════ FIREBASE ═══════════ */
const _fbConfig={
    apiKey:"AIzaSyCHFJl-U9gM1nZEjRo-F48_U_lo8kf-WDM",
    authDomain:"soge-d51a7.firebaseapp.com",
    databaseURL:"https://soge-d51a7-default-rtdb.europe-west1.firebasedatabase.app", /* ⚠️ تحقق من الرابط الفعلي في Console بعد إنشاء RTDB */
    projectId:"soge-d51a7",
    storageBucket:"soge-d51a7.firebasestorage.app",
    messagingSenderId:"612431442460",
    appId:"1:612431442460:web:dc7646b68c7652635ee5d9"
};
firebase.initializeApp(_fbConfig);
const _db=firebase.database();
const _auth=firebase.auth();
let _authReady=false;
/* لا ندخل بحساب مجهول بعد الآن — المصادقة تتم بالبريد فقط عند تسجيل الدخول */
const _authReadyPromise=new Promise(res=>{
    const t=setTimeout(()=>{_authReady=true;res();},3000);
    _auth.onAuthStateChanged(()=>{ clearTimeout(t); _authReady=true; res(); });
});
_db.goOffline();_db.goOnline();
firebase.database.enableLogging(false);

/* مفتاح Vision المشترك — عقدة عامة لكل المستخدمين المصادَقين */
window._sharedVisionKey='';
window._saveSharedVisionKey=(v)=>{ try{return _db.ref('goldpro/_appcfg/visionKey').set(v||'');}catch(e){return Promise.reject(e);} };
/* ── أسماء السلع المشتركة ── */
/* 🏪 متعدد المستأجرين: إعدادات كل مستخدم (أسماء السلع + زبائن البوابة) في مساحته الخاصة goldpro/{user}/cfg */
window._cfgRef=null; /* يُضبط عند الدخول من auth.js */
window._saveGoodsNamesFb=(arr)=>{ try{return window._cfgRef?window._cfgRef.child('goodsNames').set(Array.isArray(arr)?arr:[]):Promise.resolve();}catch(e){return Promise.reject(e);} };
/* ── بوابة الزبائن ── */
window._savePortalCustFb=(obj)=>{ try{return window._cfgRef?window._cfgRef.child('custPhones').set(obj||{}):Promise.resolve();}catch(e){return Promise.reject(e);} };
/* 🏪 المسار يتضمّن هوية المحل: portal/{هاتف}/{كلمة السر}/{المحل}
   بدونها كان محلّان لهما نفس الزبون بنفس كلمة السر يمسحان بيانات بعضهما! */
window._savePortalDataFb=(ph,pin,shop,payload)=>{ try{return _db.ref('goldpro/portal/'+ph+'/'+pin+'/'+shop).set(payload);}catch(e){return Promise.reject(e);} };
window._delPortalNodeFb=(ph,pin,shop)=>{ try{return _db.ref('goldpro/portal/'+ph+'/'+pin+'/'+shop).remove();}catch(e){return Promise.reject(e);} };
/* يُستدعى من auth.js بعد الدخول لربط مستمعي إعدادات هذا المستخدم */
window._attachUserCfg=()=>{
    if(!window._cfgRef)return;
    try{
        window._cfgRef.child('goodsNames').on('value',sn=>{
            const v=sn.val();
            if(Array.isArray(v)){
                window._goodsNames=v;
                try{localStorage.setItem('gp12_goodsNames',JSON.stringify(v));}catch(e){}
                if(typeof renderGoodsNamesList==='function')try{renderGoodsNamesList();}catch(e){}
                if(typeof _refreshGoodsSelects==='function')try{_refreshGoodsSelects();}catch(e){}
            }
        });
        window._cfgRef.child('custPhones').on('value',sn=>{
            const v=sn.val();
            if(v&&typeof v==='object'){
                window._portalCust=v;
                try{localStorage.setItem('gp12_portalCust',JSON.stringify(v));}catch(e){}
                if(typeof renderPortalCustList==='function')try{renderPortalCustList();}catch(e){}
            }
        });
    }catch(e){}
};
_auth.onAuthStateChanged(u=>{
    if(!u)return;
    try{
        _db.ref('goldpro/_appcfg/visionKey').on('value',s=>{
            const v=s.val()||'';
            window._sharedVisionKey=v;
            if(v){ try{localStorage.setItem('gp_vision_key',v);}catch(e){} }
        });
    }catch(e){}
});

let _baseRef=null;
let _fbOnline=false;
let _fbLoaded=false;

/* ── تتبع الأحداث التي لم تُرفع بعد للسحابة ── */
const _unsyncedIds=new Set();
function _updSyncIndicator(){
    const el=document.getElementById('syncIndicator');
    if(!el)return;
    if(!_fbOnline){el.textContent='🔴 أوفلاين';el.style.color='var(--rd)';return;}
    if(_unsyncedIds.size>0){
        el.textContent=`🟡 غير محفوظ (${_unsyncedIds.size})`;el.style.color='#e6a817';
    }else{
        el.textContent='🟢 متصل';el.style.color='var(--gr)';
    }
}
/* معقّم الحمولة: undefined واحد يجعل Firebase يرفض القيد للأبد */
function _cleanPayload(o){ try{return JSON.parse(JSON.stringify(o));}catch(e){return o;} }
let _lastFbErr='', _syncFail=0;
function _pushUnsyncedToFb(){
    if(!_baseRef||!_unsyncedIds.size)return;
    const pending=[..._unsyncedIds];
    pending.forEach(eid=>{
        const evt=_allEvents.find(e=>e.id===eid);
        if(!evt){_unsyncedIds.delete(eid);return;}
        try{
            _baseRef.child('events/'+eid).set(_cleanPayload(_withOwner(evt)))
                .then(()=>{_unsyncedIds.delete(eid);_syncFail=0;_updSyncIndicator();})
                .catch(e=>{_syncFail++;_fbErr(e);});
        }catch(e){_syncFail++;}
    });
}
/* إعادة محاولة تلقائية + علاج «القابس الزومبي»: بعد فشلين متتاليين يُعاد وصل RTDB برمجياً */
function _replugRTDB(){ try{_db.goOffline(); setTimeout(()=>{try{_db.goOnline();}catch(e){}},900);}catch(e){} _syncFail=0; }
let _healCycles=0,_diagShown=false,_authHealing=false;
setInterval(()=>{
    if(!_unsyncedIds.size){_healCycles=0;return;}
    if(!_fbOnline)return;
    /* ① سقوط جلسة المصادقة = رفض دائم لكل قيد — أصلحها صامتاً أولاً */
    const _noAuth=!firebase.auth().currentUser;
    const _permDenied=/PERMISSION_DENIED|permission/i.test(_lastFbErr||'');
    if((_noAuth||(_syncFail>=2&&_permDenied))&&!_authHealing&&typeof _fbSignInEmail==='function'&&_currentUser&&_encKey){
        _authHealing=true;
        _fbSignInEmail(_currentUser,_encKey,true)
            .then(()=>{_syncFail=0;setTimeout(_pushUnsyncedToFb,900);})
            .catch(()=>{})
            .finally(()=>{setTimeout(()=>{_authHealing=false;},4000);});
        _healCycles++;
    }
    /* ② القابس الزومبي: القناة ميتة رغم «متصل» */
    else if(_syncFail>=2){_replugRTDB();_healCycles++; setTimeout(_pushUnsyncedToFb,1600);}
    else _pushUnsyncedToFb();
    if(_healCycles>=3&&!_diagShown){_diagShown=true; try{showSyncDiag(true);}catch(e){}}
},12000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&_unsyncedIds.size){ if(_syncFail>=2)_replugRTDB(); setTimeout(_pushUnsyncedToFb,1200);} });
window.addEventListener('online',()=>{ if(_unsyncedIds.size)setTimeout(_pushUnsyncedToFb,1500); });
/* نافذة تشخيص المزامنة (تفتح بنقر الشارة) */
window.showSyncDiag=(auto)=>{
    let m=document.getElementById('syncDiagModal');
    if(!m){m=document.createElement('div');m.id='syncDiagModal';m.className='modal-overlay';document.body.appendChild(m);}
    const authU=(firebase.auth().currentUser?.email)||'لا جلسة!';
    m.innerHTML=`<div class="modal-box" style="max-width:420px">
      <div class="modal-header"><h3 style="font-size:.92rem">🔎 تشخيص المزامنة</h3><button class="close-btn" onclick="closeModal('syncDiagModal')">✕</button></div>
      <div style="padding:.9rem;font-size:.8rem;line-height:2;direction:rtl;text-align:right">
        ${auto?'<div style="background:rgba(220,38,38,.09);border:1px dashed var(--rd);border-radius:8px;padding:.5rem;margin-bottom:.5rem">⚠️ تعذّر الحفظ رغم محاولتَي علاج — صوّر هذه الشاشة</div>':''}
        قيود معلّقة: <b>${_unsyncedIds.size}</b><br>
        الاتصال: <b>${_fbOnline?'🟢 متصل':'🔴 أوفلاين'}</b><br>
        جلسة المصادقة: <b style="direction:ltr">${authU}</b><br>
        آخر خطأ: <b style="direction:ltr;font-size:.72rem">${_lastFbErr||'—'}</b>
        <button onclick="(async()=>{ if(!firebase.auth().currentUser&&typeof _fbSignInEmail==='function'&&_currentUser&&_encKey){await _fbSignInEmail(_currentUser,_encKey).catch(()=>{});} _replugRTDB(); setTimeout(_pushUnsyncedToFb,1400); toast('🔄 جارٍ المحاولة…','info'); })()" style="width:100%;margin-top:.6rem;background:var(--g700);color:#fff;border:none;border-radius:10px;padding:.6rem;font-family:inherit;cursor:pointer">🔄 محاولة الآن (إصلاح الجلسة + إعادة الوصل)</button>
      </div></div>`;
    m.classList.add('active');
};
try{ document.addEventListener('DOMContentLoaded',()=>{ const el=document.getElementById('syncIndicator'); if(el){el.style.cursor='pointer'; el.onclick=()=>showSyncDiag(false);} }); }catch(e){}

/* رفع حدث واحد لـ Firebase مع تتبّع حالة المزامنة — المسار الموحَّد لكل عمليات الرفع */
function _fbSetEvent(evt){
    if(!_baseRef||!evt||!evt.id)return;
    _unsyncedIds.add(evt.id);
    _updSyncIndicator();
    try{
        _baseRef.child('events/'+evt.id).set(_cleanPayload(_withOwner(evt)))
            .then(()=>{_unsyncedIds.delete(evt.id);_syncFail=0;_updSyncIndicator();})
            .catch(e=>{_syncFail++;_fbErr(e);});
    }catch(e){_fbErr(e);}
}

/* حارس الاستيراد: يوقف معالِجات المزامنة أثناء استبدال كامل البيانات */
let _importing=false;

_db.ref('.info/connected').on('value',s=>{
    const wasOffline=!_fbOnline;
    _fbOnline=!!s.val();
    _updSyncIndicator();
    /* عند استعادة الاتصال: ارفع الأحداث المعلقة */
    if(_fbOnline&&wasOffline&&_fbLoaded)_pushUnsyncedToFb();
});

let _fbErrShown=false;
function _fbErr(e){
    try{console.warn('[GoldPro sync] فشل الكتابة في Firebase:',(e&&e.code)||e);}catch(_){}
    if(!_fbErrShown){
        _fbErrShown=true;
        try{toast('⚠️ تعذّر حفظ بعض البيانات في السحابة','error');}catch(_){}
        setTimeout(()=>{_fbErrShown=false;},60000);
    }
}

/* ═══════════ ENCRYPTION ═══════════ */
let _encKey='';
function _lsSet(key,obj){
    try{
        const plain=JSON.stringify(obj);
        const stored=_encKey?CryptoJS.AES.encrypt(plain,_encKey).toString():plain;
        localStorage.setItem(key,stored);
    }catch(e){}
}
function _lsGet(key){
    try{
        const raw=localStorage.getItem(key);
        if(!raw)return null;
        if(_encKey){
            try{
                const bytes=CryptoJS.AES.decrypt(raw,_encKey);
                const plain=bytes.toString(CryptoJS.enc.Utf8);
                if(plain)return JSON.parse(plain);
            }catch(e2){}
        }
        return JSON.parse(raw);
    }catch(e){return null;}
}

/* مفتاح تشفير النسخ الاحتياطية = اسم المستخدم + كلمة المرور (في الذاكرة فقط أثناء الجلسة) */
function _backupKey(){ return (_currentUser||'')+'::'+(_encKey||''); }
const _KDF_ITER=100000;
/* تشفير كائن نسخة احتياطية: AES-256 بمفتاح مشتقّ PBKDF2-SHA256 (ملح وIV عشوائيان لكل نسخة) */
function _encryptBackup(dataObj){
    const salt=CryptoJS.lib.WordArray.random(16), iv=CryptoJS.lib.WordArray.random(16);
    const key=CryptoJS.PBKDF2(_backupKey(),salt,{keySize:256/32,iterations:_KDF_ITER,hasher:CryptoJS.algo.SHA256});
    const ct=CryptoJS.AES.encrypt(JSON.stringify(dataObj),key,{iv:iv}).toString();
    return JSON.stringify({_gpenc:2,kdf:'PBKDF2-SHA256',iter:_KDF_ITER,_user:_currentUser,_exported:Date.now(),
        salt:salt.toString(CryptoJS.enc.Hex),iv:iv.toString(CryptoJS.enc.Hex),blob:ct},null,2);
}
/* فكّ نسخة احتياطية → كائن البيانات أو null عند الفشل. يدعم v2(PBKDF2) وv1(عبارة سر) */
function _decryptBackup(parsed){
    try{
        if(parsed._gpenc===2&&parsed.blob&&parsed.salt&&parsed.iv){
            const salt=CryptoJS.enc.Hex.parse(parsed.salt), iv=CryptoJS.enc.Hex.parse(parsed.iv);
            const key=CryptoJS.PBKDF2(_backupKey(),salt,{keySize:256/32,iterations:parsed.iter||_KDF_ITER,hasher:CryptoJS.algo.SHA256});
            const plain=CryptoJS.AES.decrypt(parsed.blob,key,{iv:iv}).toString(CryptoJS.enc.Utf8);
            return plain?JSON.parse(plain):null;
        }
        if(parsed._gpenc&&parsed.blob){ /* v1: عبارة سر مباشرة */
            const plain=CryptoJS.AES.decrypt(parsed.blob,_backupKey()).toString(CryptoJS.enc.Utf8);
            return plain?JSON.parse(plain):null;
        }
    }catch(_){}
    return null;
}

/* ── مساعد: يُضيف ownerUid لكل كائن يُرفع لـ Firebase ── */
function _withOwner(obj){
    const u=firebase.auth().currentUser?.uid;
    return u?{...obj,ownerUid:u}:obj;
}

/* ═══════════ EVENT STORE — المصدر الوحيد للحقيقة ═══════════ */
let _allEvents=[];
let _fbListening=false;

function _getEvLsKey(){return 'gp_ev_'+(_currentUser||'');}

function _lsSaveEvents(){
    try{_lsSet(_getEvLsKey(),_allEvents);}catch(e){}
}
function _lsLoadEvents(){
    try{
        const stored=_lsGet(_getEvLsKey());
        if(Array.isArray(stored))_allEvents=stored;
    }catch(e){}
}

/* ═══════════ PICK BARS (خالص — لا تعديل للحالة) ═══════════ */
function _pickBarsToRemove(pool,weight){
    const bars=pool==='24'?g24:g730;
    const result={barsRemove:[],barUpdates:[]};
    let rem=weight;
    for(let i=bars.length-1;i>=0&&rem>0.001;i--){
        const bar=bars[i];
        if(bar.w<=rem+0.001){
            result.barsRemove.push(bar.id);
            rem-=bar.w;
        }else{
            result.barUpdates.push({id:bar.id,pool,newW:parseFloat((bar.w-rem).toFixed(4))});
            rem=0;
        }
    }
    return result;
}

/* ═══════════ APPLY EVENT (مُطبِّق الأحداث على حالة st) ═══════════ */
function _applyEvt(st,evt){
    const d=evt.data||{};
    const disp=evt.display||{};

    function applyBars(){
        if(d.barsRemove&&d.barsRemove.length){
            const ids=new Set(d.barsRemove);
            st.g730=st.g730.filter(b=>!ids.has(b.id));
            st.g24=st.g24.filter(b=>!ids.has(b.id));
        }
        if(d.barUpdates&&d.barUpdates.length){
            d.barUpdates.forEach(upd=>{
                const bar=st.g730.find(b=>b.id===upd.id)||st.g24.find(b=>b.id===upd.id);
                if(bar)bar.w=upd.newW;
            });
        }
        if(d.barsAdd&&d.barsAdd.length){
            d.barsAdd.forEach(bar=>{
                const meta=disp.bars&&disp.bars[bar.id];
                const nb={...bar,desc:meta?.desc||'',dt:meta?.dt||'',src:meta?.src||'',_ts:evt.ts};
                if(bar.pool==='24')st.g24.push(nb);else st.g730.push(nb);
            });
        }
        /* حقول خاصة بالرافيناج */
        if(d.barsRemove730&&d.barsRemove730.length){
            const ids=new Set(d.barsRemove730);
            st.g730=st.g730.filter(b=>!ids.has(b.id));
        }
        if(d.barUpdates730&&d.barUpdates730.length){
            d.barUpdates730.forEach(upd=>{
                const bar=st.g730.find(b=>b.id===upd.id);
                if(bar)bar.w=upd.newW;
            });
        }
        if(d.barsAdd24&&d.barsAdd24.length){
            d.barsAdd24.forEach(bar=>{
                const meta=disp.bars&&disp.bars[bar.id];
                const nb={...bar,desc:meta?.desc||'',dt:meta?.dt||'',src:meta?.src||'',_ts:evt.ts};
                st.g24.push(nb);
            });
        }
    }

    function _tagCust(c,kind){ if(c)st.custKind[c]=kind; }
    function stUpdDebt(c,m,a){
        const x=st.debts.find(dd=>dd.c===c&&dd.type===m);
        if(x){
            x.a+=a;
            if(Math.abs(x.a)<0.001)st.debts=st.debts.filter(dd=>dd!==x);
        }else if(Math.abs(a)>0.001){
            st.debts.push({c,type:m,a});
        }
    }
    function stClearDebt(c,m){
        st.debts=st.debts.filter(dd=>!(dd.c===c&&dd.type===m));
    }

    /* تسجيل العملية في السجل */
    if(disp.op){st.ops.push({...disp.op,id:evt.id});}

    switch(evt.type){

        case 'OPENING':{
            if(d.dinar&&!isNaN(d.dinar))st.B.دينار+=Number(d.dinar);
            if(Array.isArray(d.goodsItems)&&d.goodsItems.length){
                /* سلعة الكوفر الافتتاحية بالتفصيل: تدخل المخزون والبطاقة بالمكافئ 705 */
                let _eq=0;
                d.goodsItems.forEach((it,i)=>{
                    const w=Number(it.w)||0,k=Number(it.k)||0;
                    _eq+=w*k/705;
                    st.goodsStock.unshift({
                        id:(evt.id||'')+'_og'+i,
                        n:it.n||'؟', w, k, p:0,
                        src:'افتتاحي', dt:'', ts:evt.ts||0
                    });
                });
                st.B.دولار+=Math.round(_eq*1000)/1000;
            }else if(d.dollar&&!isNaN(d.dollar))st.B.دولار+=Number(d.dollar);
            applyBars();
            (d.debtRows||[]).forEach(r=>{
                const sign=r.dir==='لنا'?1:-1;
                stUpdDebt(r.c,r.type,sign*r.amt);
                if(r.kind)_tagCust(r.c,r.kind);   /* 🏷️ تصنيف الزبون: ورشة/سوق */
            });
            /* ═══ 💼 رأس المال = ما أدخلته في الافتتاحية (بالتعريف) ═══
               ذهب: السلعة الافتتاحية + ديون السلعة · دينار: الدينار الافتتاحي + ديون الدينار */
            {
                let _capG=0,_capD=Number(d.dinar)||0;
                if(Array.isArray(d.goodsItems)&&d.goodsItems.length){
                    d.goodsItems.forEach(it=>{ _capG+=(Number(it.w)||0)*(Number(it.k)||0)/705; });
                }else if(d.dollar&&!isNaN(d.dollar)) _capG+=Number(d.dollar);
                (d.debtRows||[]).forEach(r=>{
                    const sign=r.dir==='لنا'?1:-1;
                    const v=sign*(Number(r.amt)||0);
                    if(r.type==='دينار')_capD+=v;
                    else if(r.type==='دولار')_capG+=v;                 /* ديون السلعة (705) */
                    else if(r.type==='ذهب 24')_capG+=v*(1000/705);      /* محوّلة لمكافئ 705 */
                    else if(r.type==='ذهب 730')_capG+=v*(730/705);
                });
                st.capGold705+=Math.round(_capG*1000)/1000;
                st.capDin+=Math.round(_capD*100)/100;
                if((evt.ts||0)>st.capTs){ st.capTs=evt.ts||0; st.capPrice=Number(d.goldPrice)||st.capPrice||0; }
            }
            break;
        }

        case 'GT':{
            if(d.gtType==='give'){
                applyBars();
                if(!d.paper&&d.m!=='ذهب 730'&&d.m!=='ذهب 24')st.B[d.m]=(st.B[d.m]||0)-d.finalAmount;
                stUpdDebt(d.c,d.m,d.finalAmount);
            }else{
                applyBars();
                if(!d.paper&&d.m!=='ذهب 730'&&d.m!=='ذهب 24')st.B[d.m]=(st.B[d.m]||0)+d.finalAmount;
                stUpdDebt(d.c,d.m,-d.finalAmount);
            }
            /* أحداث قديمة بلا سطر سجلّ: نولّد لها سطراً من بياناتها (بحقول احتياطية) */
            if(!disp.op){
                const _d=evt.ts?new Date(evt.ts):null;
                const _amt=(d.finalAmount!=null?d.finalAmount:(d.a!=null?d.a:0));
                st.ops.push({
                    c:d.c||'؟', t:(d.gtType||d.t)==='give'?'أعطيت':'استلمت', m:d.m||'ذهب 730', a:_amt,
                    _ts:evt.ts||0,
                    dt:_d?_d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'',
                    ...(d.realW?{realW:d.realW}:{}), ...(d.realK?{realK:d.realK}:{}),
                    ...(d.note?{note:d.note}:{}),
                    id:evt.id
                });
            }
            break;
        }

        case 'DOLLAR':{
            /* ═══ gv:2 — نظام السلعة: دائماً غير خالص ═══
               شراء: بطاقة السلعة += المكافئ(705) · دين الزبون: سلعة −المكافئ (أحمر) ودينار −الأجرة (أحمر)
               بيع : بطاقة السلعة −= المكافئ       · دين الزبون: سلعة +المكافئ (أخضر) ودينار +الأجرة (أخضر)
               البيع يخصم الوزن بالتجزئة من المخزون حسب اسم السلعة (الأقدم أولاً) */
            if(d.gv===2){
                const eq=Number(d.equiv)||0, fee=Number(d.fee)||0;
                const rot=d.rot&&Number(d.rot.w)>0?d.rot:null;
                /* دالة خصم بالتجزئة من مخزون اسم معيّن — تُرجع المكافئ المخصوم فعلاً بعيار القطع */
                const _deduct=(name,weight)=>{
                    let rem=Number(weight)||0,taken=0;
                    for(let i=st.goodsStock.length-1;i>=0&&rem>0.0005;i--){
                        const g=st.goodsStock[i];
                        if(g.n!==name)continue;
                        const take=Math.min(g.w,rem);
                        taken+=take*(Number(g.k)||705)/705;
                        g.w=Math.round((g.w-take)*1000)/1000; rem=Math.round((rem-take)*1000)/1000;
                        if(g.w<=0.0005)st.goodsStock.splice(i,1);
                    }
                    return taken;
                };
                if(d.isBuy){
                    _tagCust(d.c,'workshop'); /* اشتريت منه → ورشة */
                    /* السلعة المشتراة: تدخل المخزون، دين أحمر (سلعة + أجرة) */
                    st.B.دولار+=eq;
                    stUpdDebt(d.c,'دولار',-eq);
                    if(fee)stUpdDebt(d.c,'دينار',-fee);
                    (d.items||[]).forEach((it,i)=>{
                        st.goodsStock.unshift({
                            id:(evt.id||'')+'_g'+i,
                            n:it.n||'؟', w:Number(it.w)||0, k:Number(it.k)||0, p:Number(it.p)||0,
                            src:d.c||'', dt:(disp.dollInvoice&&disp.dollInvoice.dt)||'', ts:evt.ts||0
                        });
                    });
                    /* ♻️ الروتور مرتجع للزبون: يخرج من مخزون «روتور» وينقص دينه (سلعة + أجرة) */
                    if(rot){
                        const takenEq=_deduct('روتور',rot.w);
                        st.B.دولار-=Math.round(takenEq*1000)/1000;
                        stUpdDebt(d.c,'دولار',Number(rot.eq)||0);
                        if(Number(rot.fv))stUpdDebt(d.c,'دينار',Number(rot.fv));
                    }
                    /* 💵 أخذ دينار عند الشراء: يخرج من السيولة وينقص دين الزبون بالدينار */
                    if(Number(d.cash)>0){
                        st.B.دينار-=Number(d.cash);
                        stUpdDebt(d.c,'دينار',Number(d.cash));
                    }
                    /* 💵 دفع كاصي بالدينار عند الشراء: نقد خارج → ينقص السيولة، والوزن المكافئ يزيد دين الزبون · عكس تتبّع اللاكاص المطلوب */
                    if(d.cashiCash&&Number(d.cashiCash.amt)>0){
                        st.B.دينار-=Number(d.cashiCash.amt);
                        stUpdDebt(d.c,'دولار',Number(d.cashiCash.eq)||0);
                        st.cashiBuyW-=Number(d.cashiCash.eq)||0;
                        st.cashiBuyDin-=Number(d.cashiCash.amt)||0;
                    }
                    /* ⚱️ دفع أجرة بالكاصي عند الشراء: المبلغ يُضاف لرصيد الزبون بالدينار، والسبيكة تخرج من مخزون 705 · عكس */
                    if(d.cashiFee&&Array.isArray(d.cashiFee.items)&&d.cashiFee.items.length){
                        stUpdDebt(d.c,'دينار',Number(d.cashiFee.din)||0);
                        st.cashiSoldW-=Number(d.cashiFee.eq)||0;
                        st.cashiSoldDin-=Number(d.cashiFee.din)||0;
                        d.cashiFee.items.forEach(it=>{
                            const k=Number(it.k)||705;
                            const pool=(k>=999)?st.g24:st.g730;
                            const base=(k>=999)?1000:730;
                            let need=(Number(it.w)||0)*(k/base);
                            for(let bi=0;bi<pool.length&&need>0.0000005;bi++){
                                const bar=pool[bi];
                                const bk=Number(bar.k)||base;
                                const barEq=(Number(bar.w)||0)*(bk/base);
                                if(barEq<=need+0.0000005){need=Math.round((need-barEq)*1e6)/1e6;pool.splice(bi,1);bi--;}
                                else{const takeW=need*base/bk;bar.w=Math.round((bar.w-takeW)*1e6)/1e6;need=0;}
                            }
                        });
                    }
                    /* ⚱️ دفع لاكاص عند الشراء: عيار 1000 → يخرج من مخزون 24 · غيره → من مخزون 705
                       الدين دائماً في عمود «ذهب 705» بالمكافئ */
                    if(d.kass&&Array.isArray(d.kass.items)&&d.kass.items.length){
                        d.kass.items.forEach(it=>{
                            const k=Number(it.k)||705;
                            const pool=(k>=999)?st.g24:st.g730;
                            const base=(k>=999)?1000:730;              /* وحدة المكافئ الداخلية للمخزن */
                            let need=(Number(it.w)||0)*(k/base);
                            for(let bi=0;bi<pool.length&&need>0.0000005;bi++){
                                const bar=pool[bi];
                                const bk=Number(bar.k)||base;
                                const barEq=(Number(bar.w)||0)*(bk/base);
                                if(barEq<=need+0.0000005){
                                    need=Math.round((need-barEq)*1e6)/1e6;
                                    pool.splice(bi,1); bi--;
                                }else{
                                    const takeW=need*base/bk;
                                    bar.w=Math.round((bar.w-takeW)*1e6)/1e6;
                                    need=0;
                                }
                            }
                        });
                        stUpdDebt(d.c,'دولار',Number(d.kass.eq));
                    }
                }else{
                    _tagCust(d.c,'market'); /* بعت له → سوق */
                    /* 🚫 لا تُخصم سلعة من سلعة أخرى: الخصم من مخزون نفس الاسم فقط */
                    let takenEq=0;
                    (d.items||[]).forEach(it=>{ takenEq+=_deduct(it.n,it.w); });
                    st.B.دولار-=Math.round(takenEq*1000)/1000;
                    stUpdDebt(d.c,'دولار',eq);
                    if(fee)stUpdDebt(d.c,'دينار',fee);
                    /* ♻️ الروتور يعود إليك من الزبون: يدخل مخزون «روتور» وينقص دينه (سلعة + أجرة) */
                    if(rot){
                        st.goodsStock.unshift({
                            id:(evt.id||'')+'_rot',
                            n:'روتور', w:Number(rot.w)||0, k:Number(rot.k)||0, p:Number(rot.p)||0,
                            src:d.c||'', dt:(disp.dollInvoice&&disp.dollInvoice.dt)||'', ts:evt.ts||0
                        });
                        st.B.دولار+=Number(rot.eq)||0;
                        stUpdDebt(d.c,'دولار',-(Number(rot.eq)||0));
                        if(Number(rot.fv))stUpdDebt(d.c,'دينار',-(Number(rot.fv)));
                    }
                    /* 💵 دفع دينار عند البيع: يدخل السيولة وينقص دين الزبون بالدينار */
                    if(Number(d.cash)>0){
                        st.B.دينار+=Number(d.cash);
                        stUpdDebt(d.c,'دينار',-Number(d.cash));
                    }
                    /* 💵 قبض كاصي بالدينار عند البيع: نقد داخل → يزيد السيولة، والوزن المكافئ ينقص من دين الزبون · ويُسجَّل كلاكاص يجب شراؤه */
                    if(d.cashiCash&&Number(d.cashiCash.amt)>0){
                        st.B.دينار+=Number(d.cashiCash.amt);
                        stUpdDebt(d.c,'دولار',-(Number(d.cashiCash.eq)||0));
                        st.cashiBuyW+=Number(d.cashiCash.eq)||0;
                        st.cashiBuyDin+=Number(d.cashiCash.amt)||0;
                    }
                    /* ⚱️ أجرة بالكاصي عند البيع: المبلغ ينقص من رصيد الزبون بالدينار، والسبيكة تدخل مخزون 705 · وتُحسب كلاكاص اشتُري فعلاً */
                    if(d.cashiFee&&Array.isArray(d.cashiFee.items)&&d.cashiFee.items.length){
                        stUpdDebt(d.c,'دينار',-(Number(d.cashiFee.din)||0));
                        st.cashiSoldW+=Number(d.cashiFee.eq)||0;
                        st.cashiSoldDin+=Number(d.cashiFee.din)||0;
                        d.cashiFee.items.forEach((it,i)=>{
                            const k=Number(it.k)||705;
                            const bar={
                                id:(evt.id||'')+'_cf'+i,
                                w:Number(it.w)||0, k,
                                desc:d.c?('أجرة كاصي · '+d.c):'أجرة كاصي', dt:(disp.dollInvoice&&disp.dollInvoice.dt)||'',
                                src:d.c||'', origin:'أجرة كاصي', _ts:evt.ts||0
                            };
                            if(k>=999)st.g24.push(bar); else st.g730.push(bar);
                        });
                    }
                    /* ⚱️ لاكاص من الزبون عند البيع: عيار 1000 → مخزون 24 · غيره → مخزون 705
                       الدين دائماً في عمود «ذهب 705» بالمكافئ (عمود 24 للرافيناج فقط) */
                    if(d.kass&&Array.isArray(d.kass.items)&&d.kass.items.length){
                        d.kass.items.forEach((it,i)=>{
                            const k=Number(it.k)||705;
                            const bar={
                                id:(evt.id||'')+'_ks'+i,
                                w:Number(it.w)||0, k,
                                desc:d.c?('لاكاص · '+d.c):'لاكاص', dt:(disp.dollInvoice&&disp.dollInvoice.dt)||'',
                                src:d.c||'', origin:'لاكاص', _ts:evt.ts||0
                            };
                            if(k>=999)st.g24.push(bar); else st.g730.push(bar);
                        });
                        stUpdDebt(d.c,'دولار',-Number(d.kass.eq));
                    }
                }
                if(disp.dollInvoice)st.dollInvoices.unshift(disp.dollInvoice);
                break;
            }
            if(d.isBuy){
                if(d.party)stUpdDebt(d.party,'دولار',d.a);else st.B.دولار+=d.a;
                if(d.paid)st.B.دينار-=d.dinarVal;else stUpdDebt(d.c,'دينار',-d.dinarVal);
            }else{
                if(d.paid){
                    if(d.party)stUpdDebt(d.party,'دولار',-d.a);else st.B.دولار-=d.a;
                    st.B.دينار+=d.dinarVal;
                }else{
                    if(d.party)stUpdDebt(d.party,'دولار',-d.a);else st.B.دولار-=d.a;
                    stUpdDebt(d.c,'دينار',d.dinarVal);
                }
            }
            if(disp.dollInvoice)st.dollInvoices.unshift(disp.dollInvoice);
            /* 📦 سلعة متعددة الأسطر: الشراء يُدخل كل سطر للمخزون (المصدر=الزبون، p=ثمن الشراء) */
            if(Array.isArray(d.items)&&d.items.length&&d.isBuy){
                d.items.forEach((it,i)=>{
                    st.goodsStock.unshift({
                        id:(evt.id||'')+'_g'+i,
                        n:it.n||'؟', w:Number(it.w)||0, k:Number(it.k)||0, p:Number(it.p)||0,
                        src:d.c||'', dt:(disp.dollInvoice&&disp.dollInvoice.dt)||'', ts:evt.ts||0
                    });
                });
            }
            /* سطر سجل للطرف (من أخذه/المسلم) كي تظهر العملية في سجلّه أيضاً */
            if(d.party){
                st.ops.push({
                    c:d.party, t:d.isBuy?'دولار وارد':'دولار صادر', m:'دولار', a:d.a,
                    _ts:(disp.op&&disp.op._ts)||evt.ts||Date.now(),
                    dt:(disp.op&&disp.op.dt)||'',
                    dollFrom:d.c, dr:d.r, id:evt.id+'_pty'
                });
            }
            break;
        }

        case 'SHIP':{
            applyBars();
            stUpdDebt(d.o,'ذهب 24',d.rc);
            if(d.p>0)stUpdDebt('شحن','دولار',-(d.rc*d.p));
            break;
        }

        case 'EXPENSE':{
            if(d.cur==='دولار')stUpdDebt(d.cust,'دولار',-d.a);   // علينا للزبون (نحن مدينون له)
            else st.B.دينار-=d.a;
            break;
        }

        case 'DUBAI':{
            if(d.fromDebt>0.001)stUpdDebt(d.o,'ذهب 24',-d.fromDebt);
            applyBars();
            stUpdDebt(d.o,'دولار',d.usd);
            if(disp.dubaiInvoice)st.dubaiInvoices.unshift(disp.dubaiInvoice);
            break;
        }

        case 'INVOICE_BUY':{
            _tagCust(d.c,'workshop'); /* فاتورة شراء → ورشة */
            applyBars();
            st.B.دينار-=d.akhd;
            const remB=d.tp-d.akhd;
            if(remB>0.001)stUpdDebt(d.c,'دينار',-remB);
            else if(remB<-0.001)stUpdDebt(d.c,'دينار',Math.abs(remB));
            /* 🛒 شراء سبائك 705 يُنقص «كاصي تشتريه» (اشتريت اللاكاص فعلاً) */
            if(Array.isArray(d.barsAdd)&&d.barsAdd.length){
                let boughtEq705=0, boughtDin=0;
                d.barsAdd.forEach(bar=>{
                    if(bar.pool==='24')return; /* سبائك 705 فقط */
                    boughtEq705+=(Number(bar.w)||0)*((Number(bar.k)||730)/705);
                });
                if(boughtEq705>0){
                    /* الدينار المنسوب لشراء 705 = حصته من إجمالي الفاتورة */
                    boughtDin=d.tp||0;
                    st.cashiBuyW-=boughtEq705;
                    st.cashiBuyDin-=boughtDin;
                }
            }
            if(disp.invoice)st.invoices.unshift(disp.invoice);
            break;
        }

        case 'INVOICE_SELL':{
            _tagCust(d.c,'market'); /* فاتورة بيع → سوق */
            applyBars();
            st.B.دينار+=d.akhd;
            const remS=d.tp-d.akhd;
            if(remS>0.001)stUpdDebt(d.c,'دينار',remS);
            if(disp.invoice)st.invoices.unshift(disp.invoice);
            break;
        }

        case 'RAF':{
            if(d.barsRemove730&&d.barsRemove730.length){const ids=new Set(d.barsRemove730);st.g730=st.g730.filter(b=>!ids.has(b.id));}
            if(d.barUpdates730&&d.barUpdates730.length){d.barUpdates730.forEach(upd=>{const bar=st.g730.find(b=>b.id===upd.id);if(bar)bar.w=upd.newW;});}
            if(d.barsAdd24&&d.barsAdd24.length){d.barsAdd24.forEach(bar=>{const meta=disp.bars&&disp.bars[bar.id];st.g24.push({...bar,desc:meta?.desc||'رافيناج',dt:meta?.dt||'',src:meta?.src||'رافيناج',_ts:evt.ts});});}
            stUpdDebt(d.c,'ذهب 24',d.eq24-d.lanqo);
            if(d.fee>0)stUpdDebt(d.c,'دينار',-d.fee);
            if(d.sawared>0)stUpdDebt(d.c,'دينار',d.sawared);
            if(disp.rafInvoice)st.rafInvoices.unshift(disp.rafInvoice);
            break;
        }

        case 'SETTLE':{
            const {c,type,net}=d;
            if(type==='دينار')st.B.دينار+=net;
            else if(type==='دولار')st.B.دولار+=net;
            else if(type==='ذهب 730'){
                if(net<0)st.B.vg730=(st.B.vg730||0)+Math.abs(net);
                else applyBars();
            }else if(type==='ذهب 24'){
                if(net<0)st.B.vg24=(st.B.vg24||0)+Math.abs(net);
                else applyBars();
            }
            stClearDebt(c,type);
            break;
        }

        case 'SETTLE_CASH':{
            /* تصفية نقدية بمبلغ حر: net الدين وقتها، amt المدفوع/المستلَم */
            const dir=d.net>0?1:-1;
            if(d.type==='دينار')st.B.دينار+=dir*d.amt;
            else if(d.type==='دولار')st.B.دولار+=dir*d.amt;
            stClearDebt(d.c,d.type);
            const rem=Math.abs(d.net)-d.amt;
            if(Math.abs(rem)>0.001)stUpdDebt(d.c,d.type,dir*rem);
            break;
        }

        case 'SETTLE_GSM':{
            const {c,type,net,isBuy,cashTotal,remaining}=d;
            if(d.freeBuy){
                /* شراء حرّ: الزبون مدين لك بالذهب (+) ، وأنا مدين للزبون بالنقد (−) */
                stUpdDebt(c,type,d.w);
                stUpdDebt(c,'دينار',cashTotal);
            }else{
                if(!isBuy)applyBars();
                stClearDebt(c,type);
                if(Math.abs(remaining)>0.001)stUpdDebt(c,type,net>0?remaining:-remaining);
                stUpdDebt(c,'دينار',cashTotal);
            }
            if(disp.invoice)st.invoices.unshift(disp.invoice);
            break;
        }

        case 'SETTLE_730_24':{
            const {c,partial,net,remaining}=d;
            applyBars();
            stClearDebt(c,'ذهب 730');
            if(remaining>0.001)stUpdDebt(c,'ذهب 730',net>0?remaining:-remaining);
            break;
        }

        case 'SETTLE_24_INV':{
            const {c,net,remaining}=d;
            applyBars();
            stClearDebt(c,'ذهب 24');
            if(remaining>0.001)stUpdDebt(c,'ذهب 24',net>0?remaining:-remaining);
            break;
        }

        case 'SETTLE_730_REC':{
            const {c,net,remaining}=d;
            applyBars();
            stClearDebt(c,'ذهب 730');
            if(remaining>0.001)stUpdDebt(c,'ذهب 730',remaining);
            break;
        }

        case 'BAR_ADD':
        case 'BAR_REMOVE':{
            applyBars();
            break;
        }

        case 'LOAN':{
            applyBars();
            if(d.loanEntry)st.loans.push(d.loanEntry);
            /* 🥇 سلف الذهب يُسجَّل في عمود «ذهب 705» (النوع الداخلي 'دولار')
               سبائك 24 تبقى في عمودها. توافق: الأحداث القديمة سجّلت eq730 → تُحوَّل ×730/705 */
            if(d.bt==='24'){
                stUpdDebt(d.c,'ذهب 24',(d.eq705!=null?d.eq705:(d.eq730!=null?d.eq730:d.w)));
            }else{
                const v=(d.eq705!=null)?d.eq705
                       :(d.eq730!=null)?d.eq730*(730/705)
                       :(Number(d.w)||0);
                stUpdDebt(d.c,'دولار',v);
            }
            break;
        }

        case 'SELL':{
            applyBars();
            if(d.paid)st.B.دينار+=d.total;
            else stUpdDebt(d.c,'دينار',d.total);
            if(disp.invoice)st.invoices.unshift(disp.invoice);
            break;
        }

        case 'XFER':{
            /* تحويل رصيد ذهب من حساب زبون إلى آخر — لا يمسّ المخزون إطلاقاً */
            stUpdDebt(d.from, d.srcType, -d.srcDelta);   // إنقاص من حساب المصدر
            stUpdDebt(d.to,   d.dstType,  d.dstDelta);   // إضافة لحساب الهدف (بنفس الاتجاه)
            /* سطر سجل للهدف (تحويل وارد) كي يظهر في كشف حسابه أيضاً */
            st.ops.push({
                c: d.to, t:'تحويل وارد', m: d.dstType, a: (d.wDst!=null?d.wDst:d.w),
                _ts:(disp.op&&disp.op._ts)||evt.ts||Date.now(),
                dt:(disp.op&&disp.op.dt)||'',
                xferFrom: d.from, xferInType: d.dstType,
                id: evt.id+'_in'
            });
            break;
        }

        case 'DEBT_FIX':{
            /* ضبط رصيد نوع لزبون إلى قيمة هدف (أداة أدمين) */
            stClearDebt(d.c,d.type);
            if(Math.abs(d.target||0)>0.001)stUpdDebt(d.c,d.type,d.target);
            break;
        }

        case 'CUST_RENAME':{
            /* إعادة تسمية/دمج زبون رجعياً على كل الدفاتر المبنية حتى الآن */
            const from=d.from,to=d.to;
            if(from&&to&&from!==to){
                const byKey={};
                st.debts.forEach(x=>{ if(x.c===from)x.c=to; });
                st.debts.forEach(x=>{ const k=x.c+'|'+x.type; if(byKey[k]){byKey[k].a+=x.a;x._del=true;}else byKey[k]=x; });
                st.debts=st.debts.filter(x=>!x._del&&Math.abs(x.a)>0.001);
                st.ops.forEach(o=>{ if(o.c===from)o.c=to; if(o.party===from)o.party=to; if(o.dollFrom===from)o.dollFrom=to; if(o.xferFrom===from)o.xferFrom=to; });
                [st.invoices,st.dollInvoices,st.rafInvoices].forEach(list=>list.forEach(v=>{ if(v.c===from)v.c=to; }));
                st.dubaiInvoices.forEach(v=>{ if(v.c===from)v.c=to; if(v.o===from)v.o=to; });
                st.loans.forEach(l=>{ if(l.c===from)l.c=to; });
            }
            break;
        }

        case 'HIST':{
            if(disp.invoice)st.invoices.unshift(disp.invoice);
            if(disp.dollInvoice)st.dollInvoices.unshift(disp.dollInvoice);
            if(disp.rafInvoice)st.rafInvoices.unshift(disp.rafInvoice);
            if(disp.dubaiInvoice)st.dubaiInvoices.unshift(disp.dubaiInvoice);
            if(d.loans)(d.loans).forEach(l=>st.loans.push(l));
            break;
        }
    }
}

/* ═══════════ REPROJECT — يُعيد بناء كامل الحالة من الأحداث ═══════════ */
function _reproject(){
    /* حيوية الإبطالات: إبطالٌ استُهدف هو نفسه بإبطال حيّ لا يُعتدّ به (يتيح الاسترجاع) */
    const _voidEvts=_allEvents.filter(e=>e.type==='VOID');
    let _liveVoid=new Set(_voidEvts.map(v=>v.id)), _chg=true;
    while(_chg){
        _chg=false;
        const _targets=new Set(_voidEvts.filter(v=>_liveVoid.has(v.id)).map(v=>v.data?.voids).filter(Boolean));
        for(const v of _voidEvts){
            const should=!_targets.has(v.id);
            if(should!==_liveVoid.has(v.id)){_chg=true; if(should)_liveVoid.add(v.id); else _liveVoid.delete(v.id);}
        }
    }
    const voidedIds=new Set(_voidEvts.filter(v=>_liveVoid.has(v.id)).map(v=>v.data?.voids).filter(Boolean));
    window._liveVoidIds=_liveVoid; window._voidedTargetIds=voidedIds;
    const live=_allEvents
        .filter(e=>e.type!=='VOID'&&!voidedIds.has(e.id))
        .sort((a,b)=>((a.ts||0)-(b.ts||0))||String(a.id).localeCompare(String(b.id)));

    const st={
        B:{دينار:0,دولار:0,'ذهب 730':0,'ذهب 24':0,vg730:0,vg24:0},
        g730:[],g24:[],debts:[],loans:[],goodsStock:[],
        custKind:{},  /* {اسم الزبون: 'market'|'workshop'} — market=أبيع له · workshop=أشتري منه */
        capGold705:0, capDin:0, capTs:0, capPrice:0, /* 💼 رأس المال — يُشتق من الرصيد الافتتاحي */
        cashiBuyW:0,cashiBuyDin:0,   /* كاصي بالدينار مقبوض: لاكاص يجب شراؤه + الدينار المقبوض */
        cashiSoldW:0,cashiSoldDin:0, /* أجرة بالكاصي: لاكاص اشتُري فعلاً (يُنقص) + قيمته */
        ops:[],invoices:[],dollInvoices:[],rafInvoices:[],dubaiInvoices:[]
    };
    live.forEach(evt=>_applyEvt(st,evt));

    B=st.B;
    g730=st.g730;g24=st.g24;
    debts=st.debts;loans=st.loans;
    ops=st.ops.sort((a,b)=>((b._ts||0)-(a._ts||0))||String(b.id||'').localeCompare(String(a.id||'')));
    invoices=st.invoices;
    dollInvoices=st.dollInvoices;
    goodsStock=st.goodsStock;
    window._cashiTracker={buyW:st.cashiBuyW||0,buyDin:st.cashiBuyDin||0,soldW:st.cashiSoldW||0,soldDin:st.cashiSoldDin||0};
    window._custKind=st.custKind||{};
    window._capital={gold705:st.capGold705||0,din:st.capDin||0,ts:st.capTs||0,price:st.capPrice||0};
    if(typeof renderGoodsStock==='function')try{renderGoodsStock();}catch(e){}
    /* 📱 نشر كشوف زبائن البوابة (من جهاز المحل فقط، وليس من جهاز الزبون) */
    if(!window._portalMode&&window._publishPortalDebounced)try{window._publishPortalDebounced();}catch(e){}
    rafInvoices=st.rafInvoices;
    dubaiInvoices=st.dubaiInvoices;

    syncBal();
    if(typeof updAll==='function')updAll();
}

/* ═══════════ EMIT EVENT — الكتابة الوحيدة المسموح بها ═══════════ */
function emitEvent(type,data,display){
    const evt={id:uid(),ts:Date.now(),type,data:data||{},display:display||null};
    _allEvents.push(evt);
    _lsSaveEvents();
    if(_baseRef&&_fbLoaded)_fbSetEvent(evt);
    _reproject();
}

/* ═══════════ LOAD — تحميل من localStorage ثم إعادة الإسقاط ═══════════ */
function load(){
    _lsLoadEvents();
    /* تحميل الإعدادات */
    try{
        const raw=localStorage.getItem('gp_settings_'+(_currentUser||''));
        if(raw){
            const s=JSON.parse(raw);
            if(s.goldPrice)goldPrice=s.goldPrice;
            if(s.dollarRate)dollarRate=s.dollarRate;
            if(s.dollarSellRate)dollarSellRate=s.dollarSellRate;
            if(s.dollarBuyRate)dollarBuyRate=s.dollarBuyRate;
            if(typeof s.darkMode==='boolean'){darkMode=s.darkMode;if(darkMode)applyDark();}
        }
    }catch(e){}
    if(_allEvents.length>0)_reproject();
    /* إن لم يُضبط سعر بيع الدولار بعد، استنتجه من آخر فاتورة بيع دولار */
    try{ if(!(dollarSellRate>0)){ const sells=(dollInvoices||[]).filter(x=>!x.isBuy&&Number(x.r)>0); if(sells.length)dollarSellRate=Number(sells[0].r)||0; } }catch(e){}
    try{ if(!(dollarBuyRate>0)){ const buys=(dollInvoices||[]).filter(x=>x.isBuy&&Number(x.r)>0); if(buys.length)dollarBuyRate=Number(buys[0].r)||0; } }catch(e){}
}

/* ═══════════ SAVE — يحفظ الإعدادات فقط ═══════════ */
function save(){
    const _dc=(typeof _dubaiCalcVals!=='undefined')?_dubaiCalcVals:null;
    const _tb=JSON.stringify((typeof _tarbahList!=='undefined'&&_tarbahList)?_tarbahList:[]);
    try{localStorage.setItem('gp_settings_'+(_currentUser||''),JSON.stringify({goldPrice,dollarRate,dollarSellRate,dollarBuyRate,darkMode}));}catch(e){}
    if(!_baseRef||!_fbLoaded)return;
    try{_baseRef.child('settings').set(_withOwner({goldPrice,dollarRate,dollarSellRate,dollarBuyRate,darkMode,dubaiCalc:_dc,tarbah:_tb,_ts:firebase.database.ServerValue.TIMESTAMP})).catch(_fbErr);}catch(e){}
}

let _saveTimer=null;
function _scheduleSave(){clearTimeout(_saveTimer);_saveTimer=setTimeout(save,1200);}

/* ═══════════ FIREBASE INITIAL LOAD — مزامنة الأحداث أول مرة ═══════════ */
function _fbInitialLoad(){
    if(!_baseRef)return;
    /* تحميل الإعدادات من Firebase */
    _baseRef.child('settings').once('value',s=>{
        const cfg=s.val();
        if(cfg){
            if(cfg.goldPrice)goldPrice=cfg.goldPrice;
            if(cfg.dollarRate)dollarRate=cfg.dollarRate;
            if(cfg.dollarSellRate)dollarSellRate=cfg.dollarSellRate;
            if(cfg.dollarBuyRate)dollarBuyRate=cfg.dollarBuyRate;
            if(typeof cfg.darkMode==='boolean'){darkMode=cfg.darkMode;if(darkMode)applyDark();}
            try{localStorage.setItem('gp_settings_'+(_currentUser||''),JSON.stringify({goldPrice,dollarRate,darkMode}));}catch(e){}
            if(cfg.dubaiCalc&&typeof _applyDubaiCalcSettings==='function')_applyDubaiCalcSettings(cfg.dubaiCalc);
            if(typeof cfg.tarbah==='string'&&typeof _applyTarbah==='function')_applyTarbah(cfg.tarbah);
        }
    });

    /* تحميل الأحداث من Firebase */
    _baseRef.child('events').once('value',snap=>{
        const evData=snap.val();
        if(evData){
            const remoteEvents=Object.values(evData).filter(Boolean);
            const localIds=new Set(_allEvents.map(e=>e.id));
            remoteEvents.forEach(e=>{
                if(e&&e.id&&!localIds.has(e.id)){_allEvents.push(e);localIds.add(e.id);}
            });
            const remoteIds=new Set(remoteEvents.map(e=>e?.id).filter(Boolean));
            _allEvents.forEach(e=>{
                if(e&&e.id&&!remoteIds.has(e.id))_fbSetEvent(e);
            });
            _lsSaveEvents();
            _reproject();
            toast('☁️ تمت المزامنة مع السحابة','info');
        }else if(_allEvents.length>0){
            /* لا توجد أحداث في Firebase — ارفع المحلية */
            _allEvents.forEach(e=>_fbSetEvent(e));
        }else{
            /* لا توجد بيانات إطلاقاً — جرّب الترحيل من الصيغة القديمة */
            _migrateToEvents();
        }
        _fbLoaded=true;
        _startFbSync();
        _startSettingsSync();
    }).catch(e=>{
        _fbErr(e);
        _fbLoaded=true;
        _startFbSync();
        _startSettingsSync();
    });
}

/* ═══════════ DEBOUNCED REPROJECT — لتجنب تجميد الواجهة عند استقبال دفعات من Firebase ═══════════ */
/* الحفظ المحلي يُجمَّع مع إعادة البناء: الأحداث الواردة من Firebase محفوظة سحابياً أصلاً،
   فلا داعي لتشفير كامل السجل في localStorage لكل حدث على حدة. */
let _reprojectTimer=null, _lsSaveTimer=null;
/* الحفظ المحلي (تشفير AES لكامل السجلّ) ثقيل؛ نخنقه بدل تنفيذه عند كل تغيير وارد.
   الأحداث محفوظة في السحابة أصلاً، فالكاش المحلي للعمل دون اتصال فقط. */
function _flushLsSave(){ clearTimeout(_lsSaveTimer); _lsSaveTimer=null; _lsSaveEvents(); }
function _scheduleLsSave(){ clearTimeout(_lsSaveTimer); _lsSaveTimer=setTimeout(_flushLsSave,2500); }
function _debouncedReproject(){
    clearTimeout(_reprojectTimer);
    _reprojectTimer=setTimeout(()=>{ _reproject(); _scheduleLsSave(); },100);
}
/* ضمان عدم فقدان الكاش: احفظ فوراً عند تصغير/إغلاق التطبيق */
try{
    document.addEventListener('visibilitychange',()=>{ if(document.hidden)_flushLsSave(); });
    window.addEventListener('beforeunload',_flushLsSave);
}catch(e){}

/* ═══════════ REALTIME SYNC — استماع للأحداث الجديدة من أجهزة أخرى ═══════════ */
function _startFbSync(){
    if(_fbListening)return;
    _fbListening=true;
    _baseRef.child('events').on('child_added',snap=>{
        if(_importing)return;
        const evt=snap.val();
        if(!evt||!evt.id)return;
        if(_allEvents.find(e=>e.id===evt.id))return;
        _allEvents.push(evt);
        _debouncedReproject();
    },_fbErr);
    _baseRef.child('events').on('child_removed',snap=>{
        if(_importing)return;
        const evt=snap.val();
        if(!evt||!evt.id)return;
        _allEvents=_allEvents.filter(e=>e.id!==evt.id);
        _debouncedReproject();
    },_fbErr);
}

function _startSettingsSync(){
    if(!_baseRef)return;
    _baseRef.child('settings').on('value',snap=>{
        const s=snap.val();
        if(!s)return;
        if(s.goldPrice)goldPrice=s.goldPrice;
        if(s.dollarRate)dollarRate=s.dollarRate;
        if(typeof s.darkMode==='boolean'){darkMode=s.darkMode;if(darkMode)applyDark();}
        try{localStorage.setItem('gp_settings_'+(_currentUser||''),JSON.stringify({goldPrice,dollarRate,darkMode}));}catch(e){}
        if(s.dubaiCalc&&typeof _applyDubaiCalcSettings==='function')_applyDubaiCalcSettings(s.dubaiCalc);
        if(typeof s.tarbah==='string'&&typeof _applyTarbah==='function')_applyTarbah(s.tarbah);
        if(typeof updAll==='function')updAll();
    },_fbErr);
}

/* ═══════════ MIGRATION — ترحيل بيانات الصيغة القديمة ═══════════ */
function _migrateToEvents(){
    try{
        const old=_lsGet(_LSKEY);
        if(!old||!old.B)return;
        const barsAddAll=[];
        const barsMeta={};
        (old.g730||[]).forEach(bar=>{
            const b={id:bar.id||uid(),pool:'730',w:bar.w,k:bar.k||730};
            barsAddAll.push(b);
            barsMeta[b.id]={desc:bar.desc||'رصيد مُرحَّل',dt:bar.dt||'',src:'استيراد'};
        });
        (old.g24||[]).forEach(bar=>{
            const b={id:bar.id||uid(),pool:'24',w:bar.w,k:bar.k||1000};
            barsAddAll.push(b);
            barsMeta[b.id]={desc:bar.desc||'رصيد مُرحَّل',dt:bar.dt||'',src:'استيراد'};
        });
        const openingEvt={
            id:uid(),ts:1,type:'OPENING',
            data:{
                dinar:old.B.دينار||0,
                dollar:old.B.دولار||0,
                barsAdd:barsAddAll,
                debtRows:(old.debts||[]).map(dd=>({c:dd.c,type:dd.type,amt:Math.abs(dd.a||0),dir:(dd.a||0)>=0?'لنا':'علينا'}))
            },
            display:{bars:barsMeta}
        };
        _allEvents.push(openingEvt);
        /* الفواتير والسجل كأحداث تاريخية */
        (old.ops||[]).slice().reverse().forEach(op=>{
            _allEvents.push({id:op.id||uid(),ts:(op._ts||2)+1,type:'HIST',data:{},display:{op}});
        });
        (old.invoices||[]).slice().reverse().forEach(inv=>{
            _allEvents.push({id:uid(),ts:Date.now(),type:'HIST',data:{},display:{invoice:inv}});
        });
        (old.dollInvoices||[]).slice().reverse().forEach(inv=>{
            _allEvents.push({id:uid(),ts:Date.now(),type:'HIST',data:{},display:{dollInvoice:inv}});
        });
        (old.rafInvoices||[]).slice().reverse().forEach(inv=>{
            _allEvents.push({id:uid(),ts:Date.now(),type:'HIST',data:{},display:{rafInvoice:inv}});
        });
        (old.dubaiInvoices||[]).slice().reverse().forEach(inv=>{
            _allEvents.push({id:uid(),ts:Date.now(),type:'HIST',data:{},display:{dubaiInvoice:inv}});
        });
        if(old.loans&&old.loans.length){
            _allEvents.push({id:uid(),ts:1,type:'HIST',data:{loans:old.loans},display:{}});
        }
        _lsSaveEvents();
        /* ارفع لـ Firebase */
        if(_baseRef){
            _allEvents.forEach(e=>_fbSetEvent(e));
        }
        _reproject();
        toast('📋 تم ترحيل البيانات القديمة للنظام الجديد','info');
    }catch(e){console.warn('Migration failed:',e);}
}

/* ترحيل بيانات من ملف JSON بالصيغة القديمة */
function _migrateFromSnapshot(old){
    _allEvents=[];
    _migrateToEvents._old=old;
    /* استبدال _LSKEY مؤقتاً للترحيل */
    const _prev=_lsGet(_LSKEY);
    _lsSet(_LSKEY,old);
    _migrateToEvents();
    if(_prev)_lsSet(_LSKEY,_prev);
}

/* ═══════════ EXPORT / IMPORT ═══════════ */
function exportData(){
    if(!_encKey){toast('⚠️ سجّل الخروج ثم الدخول من جديد لتفعيل التشفير قبل التصدير','error');return;}
    toast('🔒 جاري التشفير...','info');
    setTimeout(()=>{
        try{
            const out=_encryptBackup({events:_allEvents,_exported:Date.now(),_user:_currentUser});
            const blob=new Blob([out],{type:'application/json'});
            const url=URL.createObjectURL(blob);
            const dt=new Date().toLocaleDateString('fr-FR').replace(/\//g,'-');
            const a=document.createElement('a');
            a.href=url;a.download=`GoldPro_${_currentUser}_${dt}.json`;a.click();
            setTimeout(()=>URL.revokeObjectURL(url),2000);
            toast('🔒 تم تحميل النسخة الاحتياطية المشفّرة','info');
        }catch(e){toast('⚠️ فشل التشفير','error');}
    },50);
}

function importData(e){
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
        let parsed=null; try{parsed=JSON.parse(ev.target.result);}catch(_){parsed=null;}
        const apply=(data)=>{
            try{
                if(data&&data.events&&Array.isArray(data.events)){
                    if(!confirm('سيتم استبدال جميع البيانات الحالية بالنسخة الاحتياطية. هل أنت متأكد؟'))return;
                    _allEvents=data.events; _lsSaveEvents();
                    if(_baseRef){
                        _importing=true;
                        _baseRef.child('events').remove().then(()=>{
                            _allEvents.forEach(evt=>_fbSetEvent(evt));
                            setTimeout(()=>{_importing=false;},800);
                        }).catch(e=>{_fbErr(e);_importing=false;});
                    }
                    _reproject();
                    toast('✅ تم استيراد البيانات بنجاح','info');
                    try{closeModal('settingsModal');}catch(x){}
                }else if(data&&data.B){
                    if(!confirm('سيتم استيراد بيانات بالتنسيق القديم وتحويلها. هل أنت متأكد؟'))return;
                    _allEvents=[]; _lsSet(_LSKEY,data); _migrateToEvents();
                    toast('✅ تم استيراد وتحويل البيانات','info');
                    try{closeModal('settingsModal');}catch(x){}
                }else{
                    toast('⚠️ الملف غير صالح','error');
                }
            }catch(err){toast('⚠️ خطأ في معالجة البيانات','error');}
        };
        if(parsed&&parsed._gpenc&&parsed.blob){
            /* ملف مشفّر → فكّ بمفتاح المستخدم النشط حالياً */
            if(!_encKey){toast('⚠️ سجّل الدخول أولاً لتفعيل مفتاح فك التشفير','error');return;}
            toast('🔓 جاري فك التشفير...','info');
            setTimeout(()=>{
                const data=_decryptBackup(parsed);
                if(!data){toast('🚫 فشل فك التشفير — كلمة المرور خاطئة أو الملف لا يخصّك','error');return;}
                apply(data);
            },50);
        }else if(parsed&&(parsed.events||parsed.B)){
            apply(parsed); /* ملف قديم غير مشفّر — توافق رجعي */
        }else{
            toast('⚠️ الملف غير صالح','error');
        }
    };
    reader.readAsText(file);
    e.target.value='';
}

/* ═══════════ AUTO BACKUP ═══════════ */
const _BACKUP_KEY='gp12_lastBackup';
window._startAutoBackup=_startAutoBackup;
function _startAutoBackup(){
    if(window._bkStarted)return; window._bkStarted=true;
    /* الأدمن فقط */
    if(typeof _usersCache!=='undefined'&&_usersCache[_currentUser]&&_usersCache[_currentUser].isAdmin===false)return;
    setTimeout(()=>{
        const last=parseInt(localStorage.getItem(_BACKUP_KEY+'_'+_currentUser)||'0',10);
        if(Date.now()-last>12*3600*1000||!last)_doAutoBackup();
    },60*1000);
    setInterval(()=>{
        const last=parseInt(localStorage.getItem(_BACKUP_KEY+'_'+_currentUser)||'0',10);
        if(Date.now()-last>12*3600*1000)_doAutoBackup();
    },3600*1000);
}
function _doAutoBackup(){
    try{
        if(!_allEvents.length)return;
        const dataObj={events:_allEvents,_exported:Date.now(),_user:_currentUser};
        const out=_encKey?_encryptBackup(dataObj):JSON.stringify(dataObj,null,2);
        const blob=new Blob([out],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        const dt=new Date().toLocaleDateString('fr-FR').replace(/\//g,'-');
        const a=document.createElement('a');
        a.href=url;a.download=`GoldPro_auto_${_currentUser}_${dt}.json`;
        document.body.appendChild(a);a.click();document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url),2000);
        localStorage.setItem(_BACKUP_KEY+'_'+_currentUser,Date.now().toString());
        toast('💾 تم تنزيل نسخة احتياطية تلقائية','info');
    }catch(e){}
}

/* ═══════════ RESET ALL ═══════════ */
function resetAllData(){
    if(!confirm('⚠️ سيتم حذف جميع البيانات نهائياً — المخزون، السجل، الديون، الرصيد. هل أنت متأكد؟'))return;
    if(!confirm('⚠️ تأكيد أخير: لا يمكن التراجع. هل تريد المتابعة؟'))return;
    try{if(_baseRef){_baseRef.off();_baseRef.remove().catch(()=>{});}_fbListening=false;}catch(e){}
    /* ملاحظة: المفاتيح مغلَّفة بنطاق التطبيق (@ns:) — localStorage.key() يُرجع المفتاح الخام،
       لذا نجرّد البادئة قبل المطابقة ثم نحذف بالاسم المنطقي (الغلاف يعيد إضافة البادئة). */
    const _NS=window.__GP_NS||'';
    const toDel=[];
    for(let i=0;i<localStorage.length;i++){
        const raw=localStorage.key(i);
        if(!raw)continue;
        if(_NS&&!raw.startsWith(_NS))continue;              /* ليس مفتاح هذا التطبيق */
        const k=_NS?raw.slice(_NS.length):raw;              /* الاسم المنطقي */
        if(k&&(k.startsWith('gp12_')||k.startsWith('gp_ev_')||k.startsWith('gp_settings_')))toDel.push(k);
    }
    toDel.forEach(k=>localStorage.removeItem(k));
    location.reload();
}

/* ═══════════ سلة المحذوفات: قائمة الإبطالات الحيّة + الاسترجاع ═══════════ */
window._trashList=()=>{
    const live=window._liveVoidIds||new Set();
    return _allEvents.filter(e=>e.type==='VOID'&&live.has(e.id)).map(v=>{
        const t=_allEvents.find(e=>e.id===v.data?.voids);
        let desc='عملية';
        if(t){
            const dsp=t.display||{}, dd=t.data||{};
            const inv=dsp.invoice||dsp.dollInvoice||dsp.rafInvoice||dsp.dubaiInvoice;
            const typeMap={INVOICE_BUY:'فاتورة شراء',INVOICE_SELL:'فاتورة بيع',RAF:'رافيناج',DUBAI:'بيع دبي',DOLLAR:'سلعة',GT:(dd.gtType==='give'?'تسليم':'استلام'),SHIP:'شحن',EXPENSE:'مصاريف',SETTLE:'تصفية',SETTLE_GSM:(dd.freeBuy?'شراء حر':'تصفية ذهب'),XFER:'تحويل',LOAN:'سلف',SELL:'بيع سبيكة',OPENING:'رصيد افتتاحي',DEBT_FIX:'ضبط رصيد',VOID:'حذف (استرجاع سابق)'};
            const who=(dsp.op&&dsp.op.c)||(inv&&(inv.c||inv.o))||dd.c||dd.o||'';
            const amt=(dsp.op&&dsp.op.a)!=null?(dsp.op.a):(inv&&(inv.tp!=null?inv.tp:inv.usd));
            desc=(typeMap[t.type]||t.type)+(who?' — '+who:'')+(amt!=null?' — '+Number(amt).toLocaleString('fr-FR',{maximumFractionDigits:2}):'');
        }
        return {vid:v.id,ts:v.ts||0,desc,targetType:t?t.type:'?'};
    }).sort((a,b)=>b.ts-a.ts);
};
window._restoreVoid=(vid)=>{ emitEvent('VOID',{voids:vid},null); };


/* تحذير عام: هل استُهلكت سبائك هذا الحدث في عمليات لاحقة حيّة؟ */
window._warnIfConsumedEvt=(evtId)=>{
    const evt=_allEvents.find(e=>e.id===evtId&&e.type!=='VOID');
    if(!evt)return false;
    const addedBarIds=new Set([
        ...(evt.data?.barsAdd||[]).map(b=>b.id),
        ...(evt.data?.barsAdd24||[]).map(b=>b.id),
    ]);
    if(!addedBarIds.size)return false;
    const _voided=new Set(_allEvents.filter(e=>e.type==='VOID').map(e=>e.data?.voids).filter(Boolean));
    const _isLater=e=>((e.ts||0)>(evt.ts||0))||((e.ts||0)===(evt.ts||0)&&String(e.id)>String(evt.id));
    return _allEvents.some(e=>{
        if(e.type==='VOID'||e.id===evt.id||_voided.has(e.id)||!_isLater(e))return false;
        const dd=e.data||{};
        const refIds=[...(dd.barsRemove||[]),...(dd.barsRemove730||[]),...((dd.barUpdates||[]).map(u=>u.id)),...((dd.barUpdates730||[]).map(u=>u.id))];
        return refIds.some(bid=>addedBarIds.has(bid));
    });
};
function _voidByInvId(field,id){
    const evt=_allEvents.find(e=>e.display&&e.display[field]&&e.display[field].id===id&&e.type!=='VOID');
    if(!evt){return false;}

    /* ── مفارقة VOID: تحذير إذا استُهلكت سبائك هذا الحدث في عمليات لاحقة حيّة ── */
    const addedBarIds=new Set([
        ...(evt.data?.barsAdd||[]).map(b=>b.id),
        ...(evt.data?.barsAdd24||[]).map(b=>b.id),
    ]);
    if(addedBarIds.size>0){
        const _voided=new Set(_allEvents.filter(e=>e.type==='VOID').map(e=>e.data?.voids).filter(Boolean));
        const _isLater=e=>((e.ts||0)>(evt.ts||0))||((e.ts||0)===(evt.ts||0)&&String(e.id)>String(evt.id));
        const laterConsumed=_allEvents.some(e=>{
            if(e.type==='VOID'||e.id===evt.id||_voided.has(e.id)||!_isLater(e))return false;
            const dd=e.data||{};
            const refIds=[
                ...(dd.barsRemove||[]),
                ...(dd.barsRemove730||[]),
                ...((dd.barUpdates||[]).map(u=>u.id)),
                ...((dd.barUpdates730||[]).map(u=>u.id)),
            ];
            return refIds.some(bid=>addedBarIds.has(bid));
        });
        if(laterConsumed){
            toast('⚠️ تحذير: سبائك من هذه العملية استُهلكت في عمليات لاحقة — راجع الرصيد بعد الحذف','error');
        }
    }

    emitEvent('VOID',{voids:evt.id},null);
    return true;
}
/* هل خرجت سبائك هذه الفاتورة من الكوفر (استُهلكت في بيع/رافيناج لاحق حيّ)؟ */
window._invBarsConsumedF=(field,id)=>{
    const evt=_allEvents.find(e=>e.display&&e.display[field]&&e.display[field].id===id&&e.type!=='VOID');
    if(!evt)return false;
    const added=new Set([...(evt.data?.barsAdd||[]).map(b=>b.id),...(evt.data?.barsAdd24||[]).map(b=>b.id)]);
    if(!added.size)return false;
    const _voided=new Set(_allEvents.filter(e=>e.type==='VOID').map(e=>e.data?.voids).filter(Boolean));
    const _later=e=>((e.ts||0)>(evt.ts||0))||((e.ts||0)===(evt.ts||0)&&String(e.id)>String(evt.id));
    return _allEvents.some(e=>{
        if(e.type==='VOID'||e.id===evt.id||_voided.has(e.id)||!_later(e))return false;
        const dd=e.data||{};
        const ref=[...(dd.barsRemove||[]),...(dd.barsRemove730||[]),...((dd.barUpdates||[]).map(u=>u.id)),...((dd.barUpdates730||[]).map(u=>u.id))];
        return ref.some(bid=>added.has(bid));
    });
};
window._invBarsConsumed=(id)=>window._invBarsConsumedF('invoice',id);
/* نوع الحدث الأصلي لفاتورة (INVOICE_BUY / INVOICE_SELL / SETTLE_GSM / HIST ...) */
window._invEventType=(id)=>{
    const evt=_allEvents.find(e=>e.display&&e.display.invoice&&e.display.invoice.id===id&&e.type!=='VOID');
    return evt?evt.type:null;
};
/* لقطة من حدث فاتورة حيّ + إعادة بثّها (لاسترجاع الفاتورة عند إلغاء التعديل) */
window._invSnapshot=(field,id)=>{
    const e=_allEvents.find(ev=>ev.display&&ev.display[field]&&ev.display[field].id===id&&ev.type!=='VOID');
    return e?{type:e.type,data:JSON.parse(JSON.stringify(e.data||{})),display:JSON.parse(JSON.stringify(e.display||{}))}:null;
};
window._reemitSnapshot=(snap)=>{ if(snap&&snap.type)emitEvent(snap.type,snap.data,snap.display); };

window.delDoll=(id)=>{
    if(!confirm('حذف هذه الفاتورة وعكس أثرها؟'))return;
    if(!_voidByInvId('dollInvoice',id)){
        dollInvoices=dollInvoices.filter(x=>x.id!==id);
        renderArchive();
    }
    toast('🗑️ تم الحذف','info');
};

window.delDubai=(id)=>{
    if(!confirm('حذف هذه الفاتورة وعكس أثرها؟'))return;
    if(!_voidByInvId('dubaiInvoice',id)){
        dubaiInvoices=dubaiInvoices.filter(x=>x.id!==id);
        renderArchive();
    }
    toast('🗑️ تم الحذف','info');
};
