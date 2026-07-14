/* ═══════════ INVENTORY ═══════════ */
function addBar(type,w,k,desc,src){
    const bar={id:uid(),w,k:k||(type==='24'?1000:730),desc:desc||(type==='24'?'سبيكة':'قطعة'),dt:new Date().toLocaleDateString('fr-FR'),src:src||'يدوي',_ts:Date.now()};
    if(type==='24')g24.push(bar);else g730.push(bar);
    /* لا تستدع syncBal() هنا — تُستدعى هذه الدالة من _applyEvt أثناء _reproject،
       وsyncBal() تُنفَّذ مرة واحدة في نهاية _reproject بعد اكتمال كل الأحداث */
}
function removeFromInventory(type,weight){
    const bars=type==='24'?g24:g730;
    let rem=weight;
    for(let i=bars.length-1;i>=0&&rem>0.001;i--){
        if(bars[i].w<=rem+0.001){rem-=bars[i].w;bars.splice(i,1)}
        else{bars[i].w-=rem;rem=0}
    }
    /* لا تستدع syncBal() هنا — راجع التعليق في addBar */
}
window.openInventory=(type)=>{
    invType=type;
    document.getElementById('invModalTitle').textContent=type==='24'?'💎 مخزون سبائك الذهب (24)':'👑 مخزون ذهب 705 (القطع بوزنها وعيارها الفعلي)';
    document.getElementById('invModal').classList.add('active');
    renderInvModal();
};
function renderInvModal(){
    const bars=invType==='24'?g24:g730;
    const tw=bars.reduce((s,b)=>s+(b.w||0),0);
    document.getElementById('invCount').textContent=bars.length;
    document.getElementById('invTotalW').textContent=fmt(tw,2)+' g';
    const c=document.getElementById('invBarsList');
    if(!bars.length){c.innerHTML='<div style="text-align:center;padding:2rem;color:var(--t3)"><i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:.5rem"></i>المخزون فارغ</div>';return}
    c.innerHTML=[...bars].reverse().map(b=>`
        <div class="bar-item">
            <div class="bar-info">
                <strong>${fmt(b.w,2)} غ</strong>
                <span style="font-size:.66rem;color:var(--g600);font-weight:700"> — عيار ${fmt(b.k||0,1)}</span>
                <small>${b.desc||''} | ${b.dt||''}</small>
            </div>
            <div class="bar-actions">
                <button class="bsm sell" onclick="startSell('${invType}','${b.id}')">بيع</button>
                <button class="bsm loan" onclick="startLoan('${invType}','${b.id}')">سلف</button>
                ${invType==='730'?(_rafSentIds.has(b.id)?`<button class="bsm" disabled style="border-color:#6b7280;color:#6b7280;background:rgba(107,114,128,.08);opacity:.5;cursor:not-allowed" title="أُضيفت للرافيناج">✅ أُضيفت</button>`:`<button class="bsm" onclick="sendBarToRaf('730','${b.id}')" style="border-color:#ea580c;color:#ea580c;background:rgba(234,88,12,.08)" title="تحويل للرافيناج">🔥 رافيناج</button>`):''}
            </div>
        </div>`).join('');
}

/* ═══════════ LOAN ═══════════ */
window.startLoan=(type,id)=>{
    const bars=type==='24'?g24:g730;targetBar=bars.find(b=>b.id===id);targetBarType=type;
    if(!targetBar)return;
    document.getElementById('loanInfo').innerHTML=`📦 ${targetBar.desc||'قطعة'} | الوزن: <strong>${fmt(targetBar.w,2)} غ</strong> | العيار: <strong>${fmt(targetBar.k||0,1)}</strong>`;
    document.getElementById('loanAmount').value=targetBar.w;
    document.getElementById('loanCustomer').value='';
    document.getElementById('loanBalBox').style.display='none';
    document.getElementById('loanModal').classList.add('active');
    closeModal('invModal');
    setTimeout(()=>document.getElementById('loanCustomer').focus(),350);
};
window.confirmLoan=()=>{
    if(!targetBar)return;
    const c=document.getElementById('loanCustomer').value.trim();
    const a=parseFloat(document.getElementById('loanAmount').value);
    if(!c)return toast('أدخل اسم الزبون','error');
    if(isNaN(a)||a<=0||a>targetBar.w+0.001)return toast('كمية غير صالحة','error');
    const realA=Math.min(a,targetBar.w);
    /* حساب حركة السبيكة */
    let barsRemove=[],barUpdates=[];
    if(realA>=targetBar.w-0.001){
        barsRemove=[targetBar.id];
    }else{
        barUpdates=[{id:targetBar.id,pool:targetBarType,newW:parseFloat((targetBar.w-realA).toFixed(4))}];
    }
    const loanEntry={id:uid(),c,w:realA,k:targetBar.k,desc:targetBar.desc||'',bt:targetBarType,dt:new Date().toLocaleDateString('fr-FR'),ret:false};
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    const bt=targetBarType;
    targetBar=null;targetBarType=null;
    const eq730=bt==='24'?realA:parseFloat((realA*((loanEntry.k||730)/730)).toFixed(4)); /* دين السلف بمكافئ 730 موحّد */
    emitEvent('LOAN',
        {c,bt,w:realA,eq730,loanEntry,barsRemove,barUpdates},
        {op:{c,t:'سلف',m:bt==='24'?'ذهب 24':'ذهب 730',a:bt==='24'?realA:eq730,realW:bt==='24'?undefined:realA,realK:bt==='24'?undefined:(loanEntry.k||730),_ts:Date.now(),dt:nowStr}}
    );
    closeModal('loanModal');
    toast('🤝 تم التسليف بنجاح');
};
window.showLoanBalance=()=>{
    const c=document.getElementById('loanCustomer').value.trim(),box=document.getElementById('loanBalBox');
    if(!c){box.style.display='none';return}
    const m=targetBarType==='24'?'ذهب 24':'ذهب 730',b=getCustBal(c,m);
    box.innerHTML=`👤 رصيد ${m}: <strong>${fmt(b,2)} غ</strong>`;box.style.display='block';
};

/* ═══════════ SELL FROM INVENTORY ═══════════ */
let _sellPaid=true;
function setSellPaid(paid){
    _sellPaid=paid;
    document.getElementById('sellPaidBtn').style.background=paid?'var(--gr)':'transparent';
    document.getElementById('sellPaidBtn').style.color=paid?'#fff':'var(--t2)';
    document.getElementById('sellPaidBtn').style.borderColor=paid?'var(--gr)':'var(--border)';
    document.getElementById('sellUnpaidBtn').style.background=paid?'transparent':'var(--rd)';
    document.getElementById('sellUnpaidBtn').style.color=paid?'var(--t2)':'#fff';
    document.getElementById('sellUnpaidBtn').style.borderColor=paid?'var(--border)':'var(--rd)';
}
window.setSellPaid=setSellPaid;
window.startSell=(type,id)=>{
    const bars=type==='24'?g24:g730;targetBar=bars.find(b=>b.id===id);targetBarType=type;
    if(!targetBar)return;
    const k=targetBar.k||0;
    document.getElementById('sellInfo').innerHTML=`📦 ${targetBar.desc||'قطعة'} | الوزن: <strong>${fmt(targetBar.w,2)} غ</strong> | العيار: <strong>${fmt(k,1)}</strong>`;
    document.getElementById('sellCustomer').value='';
    document.getElementById('sellAmount').value=targetBar.w;
    document.getElementById('sellPrice').value=goldPrice;
    document.getElementById('sellTotal').textContent=fmt(targetBar.w*k/730*goldPrice,0)+' DZD';
    setSellPaid(true);
    document.getElementById('sellModal').classList.add('active');
    closeModal('invModal');
    setTimeout(()=>document.getElementById('sellCustomer').focus(),350);
};
window.confirmSell=()=>{
    if(!targetBar)return;
    const c=document.getElementById('sellCustomer').value.trim();
    if(!c)return toast('أدخل اسم الزبون','error');
    const a=parseFloat(document.getElementById('sellAmount').value);
    const p=parseFloat(document.getElementById('sellPrice').value);
    if(isNaN(a)||a<=0||a>targetBar.w+0.001)return toast('كمية غير صالحة','error');
    if(isNaN(p)||p<=0)return toast('السعر غير صالح','error');
    const k=targetBar.k||0,realA=Math.min(a,targetBar.w);
    const eq730=realA*k/730,total=Math.round(eq730*p),is1000=k>=999;
    const paid=_sellPaid;
    /* حساب حركة السبيكة */
    let barsRemove=[],barUpdates=[];
    if(realA>=targetBar.w-0.001){
        barsRemove=[targetBar.id];
    }else{
        barUpdates=[{id:targetBar.id,pool:targetBarType,newW:parseFloat((targetBar.w-realA).toFixed(4))}];
    }
    const iid='INV-'+uid();
    const dt=new Date().toLocaleDateString('fr-FR');
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    const _inv={
        id:iid,c,t:'sell',ps:paid?'full':'credit',dt,
        items:[{id:uid(),w:realA,k,is1000,eq730,ppg:p,total,sbt:targetBarType,desc:targetBar.desc||''}],
        tp:total,akhd:paid?total:0
    };
    const _sbt=targetBarType; /* نحفظ القيمة قبل الإعادة لـ null */
    targetBar=null;targetBarType=null;
    emitEvent('SELL',
        {c,paid,total,barsRemove,barUpdates,iid},
        {invoice:_inv,op:{c,t:'بيع',m:'دينار',a:total,_ts:Date.now(),dt:nowStr,ppg:p,total,paid,eq730,iid,sbt:_sbt}}
    );
    closeModal('sellModal');
    toast(paid?'✅ تم البيع — خالص':'✅ تم البيع — غير خالص');
    setTimeout(()=>printInv(iid),400);
};

/* ═══════════ تحويل سبيكة مباشرة للرافيناج (بدون تنقل) ═══════════ */
window.sendBarToRaf=(type,id)=>{
    const bars=type==='24'?g24:g730;
    const bar=bars.find(b=>b.id===id);
    if(!bar)return;
    /* إيجاد أول صف فارغ في جدول الرافيناج */
    let targetRow=-1;
    for(let i=1;i<=rafRows;i++){
        const wEl=document.getElementById('rafW_'+i);
        if(wEl&&wEl.value.trim()===''){targetRow=i;break;}
    }
    /* إذا لا يوجد صف فارغ، أضف صفاً جديداً */
    if(targetRow===-1){
        addRafRow();
        targetRow=rafRows;
    }
    /* تعبئة الصف */
    const wEl=document.getElementById('rafW_'+targetRow);
    const kEl=document.getElementById('rafK_'+targetRow);
    if(wEl)wEl.value=bar.w;
    if(kEl)kEl.value=bar.k||730;
    if(typeof calcRaf==='function')calcRaf();
    /* تسجيل الـ ID لمنع الإضافة مرة ثانية */
    _rafSentIds.add(id);
    renderInvModal();
    /* رسالة تأكيد — بدون إغلاق المودال أو التنقل */
    toast(`🔥 أُضيفت للرافيناج — الصف ${targetRow}`,'success');
};
document.getElementById('sellAmount').addEventListener('input',function(){
    const a=parseFloat(this.value)||0,k=targetBar?.k||0,p=parseFloat(document.getElementById('sellPrice').value)||0;
    document.getElementById('sellTotal').textContent=fmt(a*k/730*p,0)+' DZD';
});
document.getElementById('sellPrice').addEventListener('input',function(){
    const a=parseFloat(document.getElementById('sellAmount').value)||0,k=targetBar?.k||0;
    document.getElementById('sellTotal').textContent=fmt(a*k/730*(parseFloat(this.value)||0),0)+' DZD';
});
