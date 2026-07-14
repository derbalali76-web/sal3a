
/* ═══════════ INVOICE (inline table) ═══════════ */
let invRows=6;
let _editingInvId=null;
/* map rowIndex → {barId, barType} for sell mode */
const invRowBar={};

function parseInvNum(v){
    if(!v&&v!==0)return 0;
    return parseFloat(String(v).replace(/\s/g,'').replace(',','.'))||0;
}

function fmtInput(el,d){const n=parseInvNum(el.value);if(n>0)el.value=fmt(n,d);}
function rawInput(el){const n=parseInvNum(el.value);if(n>0)el.value=String(n).replace(',','.');}

/* ── مسودة الفاتورة (تُحفظ تلقائياً حتى بعد إعادة تحميل الصفحة) ── */
function saveDraft(){
    try{
        const rows=[];
        for(let i=1;i<=invRows;i++){
            rows.push({
                w:document.getElementById(`inv_w_${i}`)?.value||'',
                k:document.getElementById(`inv_k_${i}`)?.value||'',
                p:document.getElementById(`inv_p_${i}`)?.value||''
            });
        }
        _lsSet(_LSDRAFT,{
            c:document.getElementById('invCustomer')?.value||'',
            t:document.getElementById('invType')?.value||'buy',
            ps:document.getElementById('invPaid')?.value||'debt',
            akhd:document.getElementById('invAkhd')?.value||'',
            rows
        });
    }catch(e){}
}
function restoreDraft(){
    try{
        const d=_lsGet(_LSDRAFT);
        if(!d)return;
        if(d.c)document.getElementById('invCustomer').value=d.c;
        if(d.t)document.getElementById('invType').value=d.t;
        if(d.ps)document.getElementById('invPaid').value=d.ps;
        if(d.akhd)document.getElementById('invAkhd').value=d.akhd;
        if(d.rows)d.rows.slice(0,invRows).forEach((r,idx)=>{
            const i=idx+1;
            if(r.w){const el=document.getElementById(`inv_w_${i}`);if(el)el.value=r.w;}
            if(r.k){const el=document.getElementById(`inv_k_${i}`);if(el)el.value=r.k;}
            if(r.p){const el=document.getElementById(`inv_p_${i}`);if(el)el.value=r.p;}
            if(r.w||r.p)calcInvRow(i);
        });
        if(d.c)onInvCustomerInput();else calcInvTotals();
        if(d.t)onInvTypeChange();
    }catch(e){}
}
function invRowHtml(i){
    return`<tr id="invTR_${i}">
        <td class="inv-rn">${i}</td>
        <td><input type="text" class="inv-ci" id="inv_w_${i}" autocomplete="off"
            oninput="calcInvRow(${i});saveDraft()" onkeydown="invNav(event,${i},'w')"
            onblur="fmtInput(this,2)" onfocus="rawInput(this)"></td>
        <td><input type="text" class="inv-ci" id="inv_k_${i}" autocomplete="new-password"
            oninput="calcInvRow(${i});saveDraft()" onkeydown="invNav(event,${i},'k')"></td>
        <td class="inv-auto-cell" id="inv_eq_${i}">—</td>
        <td><input type="text" class="inv-ci" id="inv_p_${i}" autocomplete="off"
            dir="ltr" style="text-align:right"
            oninput="liveNum(this);calcInvRow(${i});_maybeSuggestPrice(${i});saveDraft()" onkeydown="invNav(event,${i},'p')"
            onfocus="rawInput(this)"></td>
        <td class="inv-auto-cell inv-sum-cell" id="inv_t_${i}">—</td>
    </tr>`;
}
function initInvTable(){
    let html='';
    for(let i=1;i<=invRows;i++) html+=invRowHtml(i);
    document.getElementById('invInlineBody').innerHTML=html;
}
window.addInvRow=function(noFocus){
    invRows++;
    const tbody=document.getElementById('invInlineBody');
    tbody.insertAdjacentHTML('beforeend',invRowHtml(invRows));
    if(!noFocus) document.getElementById(`inv_w_${invRows}`)?.focus();
    saveDraft();
};

/* ── اقتراح تعميم السعر على كل السبائك ── */
function _maybeSuggestPrice(i){
    const p=parseInvNum(document.getElementById(`inv_p_${i}`)?.value);
    if(!(p>0)){ _hidePriceSuggest(); return; }
    let need=0;
    for(let r=1;r<=invRows;r++){
        if(r===i)continue;
        const w=parseInvNum(document.getElementById(`inv_w_${r}`)?.value);
        const pr=parseInvNum(document.getElementById(`inv_p_${r}`)?.value);
        if(w>0 && !(pr>0)) need++;
    }
    if(need<1){ _hidePriceSuggest(); return; }
    _showPriceSuggest(p,need+1);
}
function _showPriceSuggest(p,count){
    let bar=document.getElementById('priceSuggestBar');
    if(!bar){
        bar=document.createElement('div');
        bar.id='priceSuggestBar';
        bar.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:9999;background:var(--card2);border:1.5px solid #7c3aed;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.22);padding:.55rem .75rem;display:flex;align-items:center;gap:.55rem;font-family:Tajawal,sans-serif;max-width:92vw';
        document.body.appendChild(bar);
    }
    bar.innerHTML=`<span style="font-size:.8rem;color:var(--t)">تعميم <strong style="color:#7c3aed">${fmt(p,0)}</strong> على ${count} سبيكة؟</span>
        <button onclick="applyPriceToAll(${p})" style="background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:.35rem .75rem;font-weight:800;font-size:.78rem;cursor:pointer;font-family:inherit">تعميم</button>
        <button onclick="_hidePriceSuggest()" style="background:transparent;border:none;color:var(--t2,#999);font-size:1rem;cursor:pointer;padding:0 .2rem">✕</button>`;
    bar.style.display='flex';
}
window._maybeSuggestPrice=_maybeSuggestPrice;
window._hidePriceSuggest=()=>{ const b=document.getElementById('priceSuggestBar'); if(b)b.style.display='none'; };
window.applyPriceToAll=(p)=>{
    for(let r=1;r<=invRows;r++){
        const w=parseInvNum(document.getElementById(`inv_w_${r}`)?.value);
        if(w>0){
            const pe=document.getElementById(`inv_p_${r}`);
            if(pe){ pe.value=String(p); if(typeof liveNum==='function')liveNum(pe); calcInvRow(r); }
        }
    }
    _hidePriceSuggest(); saveDraft();
    toast('✅ عُمّم السعر على كل السبائك','info');
};

function invNav(e,row,col){
    const order=['w','k','p'];
    const ci=order.indexOf(col);
    if(e.key==='Enter'||e.key==='Tab'){
        e.preventDefault();
        if(ci<order.length-1) document.getElementById(`inv_${order[ci+1]}_${row}`)?.focus();
        else if(row<invRows) document.getElementById(`inv_w_${row+1}`)?.focus();
        else addInvRow();
    } else if(e.key==='ArrowDown'){
        e.preventDefault();
        if(row<invRows) document.getElementById(`inv_${col}_${row+1}`)?.focus();
    } else if(e.key==='ArrowUp'){
        e.preventDefault();
        if(row>1) document.getElementById(`inv_${col}_${row-1}`)?.focus();
    } else if(e.key==='ArrowRight'&&e.target.selectionStart===0){
        /* RTL: يمين = عمود سابق */
        e.preventDefault();
        if(ci>0) document.getElementById(`inv_${order[ci-1]}_${row}`)?.focus();
    } else if(e.key==='ArrowLeft'&&e.target.selectionStart===e.target.value.length){
        /* RTL: يسار = عمود تالي */
        e.preventDefault();
        if(ci<order.length-1) document.getElementById(`inv_${order[ci+1]}_${row}`)?.focus();
    }
}

function calcInvRow(i){
    const w=parseInvNum(document.getElementById(`inv_w_${i}`)?.value);
    const kRaw=document.getElementById(`inv_k_${i}`)?.value;
    const k=parseInvNum(kRaw||'712')||712;
    const p=parseInvNum(document.getElementById(`inv_p_${i}`)?.value);
    const eq=w>0?w*k/705:0;
    const total=eq*p;
    const eqEl=document.getElementById(`inv_eq_${i}`);
    const tEl=document.getElementById(`inv_t_${i}`);
    if(eqEl)eqEl.textContent=w>0?fmt(eq,2):'—';
    if(tEl)tEl.textContent=(w>0&&p>0)?fmt(total,0):'—';
    /* صفّ تلقائي: ما إن يمتلئ الصفّ الأخير بوزن حتى يُضاف صفّ فارغ تحته */
    if(i===invRows && w>0 && invRows<300) addInvRow(true);
    calcInvTotals();
}

function _checkInvDupes(){
    const seen={};
    for(let i=1;i<=invRows;i++){
        const w=parseInvNum(document.getElementById(`inv_w_${i}`)?.value);
        if(!w)continue;
        const k=parseInvNum(document.getElementById(`inv_k_${i}`)?.value||'712')||712;
        const key=`${Math.round(w*1000)}|${Math.round(k*10)}`;
        (seen[key]=seen[key]||[]).push(i);
    }
    for(let i=1;i<=invRows;i++){
        const tr=document.getElementById(`invTR_${i}`);
        if(!tr)continue;
        const w=parseInvNum(document.getElementById(`inv_w_${i}`)?.value);
        const k=parseInvNum(document.getElementById(`inv_k_${i}`)?.value||'712')||712;
        const key=`${Math.round(w*1000)}|${Math.round(k*10)}`;
        const isDup=w>0&&seen[key]&&seen[key].length>1;
        tr.style.background=isDup?'rgba(239,68,68,.13)':'';
        tr.style.outline=isDup?'1.5px solid rgba(239,68,68,.4)':'';
        tr.title=isDup?'⚠️ وزن وعيار مكرر!':'';
    }
}
function calcInvTotals(){
    let sumEq=0,sumTotal=0;
    for(let i=1;i<=invRows;i++){
        const w=parseInvNum(document.getElementById(`inv_w_${i}`)?.value);
        const k=parseInvNum(document.getElementById(`inv_k_${i}`)?.value||'712')||712;
        const p=parseInvNum(document.getElementById(`inv_p_${i}`)?.value);
        if(w>0){sumEq+=w*k/705;sumTotal+=w*k/705*p;}
    }
    document.getElementById('invSumEq730').textContent=sumEq>0?fmt(sumEq,2):'—';
    document.getElementById('invSumTotal').textContent=sumTotal>0?fmt(sumTotal,0):'—';
    const prevBal=parseInvNum(document.getElementById('invPrevBal').dataset.val||'0');
    const akhd=parseInvNum(document.getElementById('invAkhd')?.value);
    _checkInvDupes();
    const isSell=document.getElementById('invType').value==='sell';
    /* بيع: prevBal يُضاف (الزبون مدين بأكثر) — شراء: prevBal يُطرح (يُقاصّ دينه) */
    const final=isSell?(sumTotal+prevBal-akhd):(sumTotal-prevBal-akhd);
    const fEl=document.getElementById('invFinalTotal');
    if(fEl){
        fEl.textContent=sumTotal>0?fmt(final,0):'—';
        fEl.style.color=final>=0?'var(--gr)':'var(--rd)';
    }
}

window.onInvCustomerInput=function(){
    const c=document.getElementById('invCustomer').value.trim();
    const prevEl=document.getElementById('invPrevBal');
    if(!c){prevEl.textContent='—';prevEl.dataset.val='0';calcInvTotals();return;}
    const b=getCustBal(c,'دينار');
    prevEl.textContent=fmt(b,0)+' دج';
    prevEl.style.color=b>=0?'var(--gr)':'var(--rd)';
    prevEl.dataset.val=String(b);
    calcInvTotals();saveDraft();
};

window.onInvTypeChange=function(){
    const isSell=document.getElementById('invType').value==='sell';
    const panel=document.getElementById('invSellPanel');
    if(!isSell){panel.style.display='none';return;}
    panel.style.display='block';
    const all=[...g24.map(b=>({...b,btype:'24'})),...g730.map(b=>({...b,btype:'730'}))];
    document.getElementById('invSellList').innerHTML=!all.length
        ?'<div style="color:var(--t3);font-size:.68rem;padding:.3rem"><i class="fas fa-inbox"></i> المخزون فارغ</div>'
        :all.map(b=>`<div class="bar-item" onclick="fillInvRowFromBar('${b.btype}','${b.id}')">
            <div><strong>${fmt(b.w,2)} غ</strong>
            <span style="font-size:.62rem;color:var(--t2)"> — عيار ${fmt(b.k||0,1)}</span>
            ${b.desc?`<span style="font-size:.6rem;color:var(--t3)"> — ${b.desc}</span>`:''}
            </div><button class="bsm sell" style="pointer-events:none">بيع</button></div>`).join('');
};

window.fillInvRowFromBar=function(btype,barId){
    const bars=btype==='24'?g24:g730;
    const bar=bars.find(b=>b.id===barId);
    if(!bar)return;
    /* find first empty row */
    let emptyRow=-1;
    for(let i=1;i<=invRows;i++){
        if(!parseInvNum(document.getElementById(`inv_w_${i}`)?.value)){emptyRow=i;break;}
    }
    if(emptyRow===-1){addInvRow();emptyRow=invRows;}
    document.getElementById(`inv_w_${emptyRow}`).value=fmt(bar.w,2);
    document.getElementById(`inv_k_${emptyRow}`).value=String(bar.k||730);
    invRowBar[emptyRow]={barId,btype};
    calcInvRow(emptyRow);
    document.getElementById(`inv_p_${emptyRow}`)?.focus();
};

function updateInvNo(){
    const n=invoices.length+1;
    const s=String(n);
    /* format like "4 323" */
    document.getElementById('invNo').textContent=s.replace(/\B(?=(\d{3})+(?!\d))/g,' ');
}
function updateInvDate(){
    const now=new Date();
    const d=now.toLocaleDateString('fr-FR');
    const t=now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    const el=document.getElementById('invDate');
    if(el)el.textContent=d+' / '+t;
}

function resetInvForm(){
    /* إعادة بناء صفوف الجدول من جديد بعد إعادة ضبط العدد */
    _editingInvId=null;
    if(typeof _hideEditBanner==='function')_hideEditBanner();
    if(typeof _hidePriceSuggest==='function')_hidePriceSuggest();
    invRows=6;
    initInvTable();
    document.getElementById('invCustomer').value='';
    document.getElementById('invAkhd').value='';
    const prevEl=document.getElementById('invPrevBal');
    prevEl.textContent='—';prevEl.dataset.val='0';
    document.getElementById('invSumEq730').textContent='—';
    document.getElementById('invSumTotal').textContent='—';
    document.getElementById('invFinalTotal').textContent='—';
    Object.keys(invRowBar).forEach(k=>delete invRowBar[k]);
    localStorage.removeItem(_LSDRAFT);
    /* لا نقترح رقماً — يُعيَّن عند الحفظ فقط */
    document.getElementById('invNo').textContent='----';
    updateInvDate();
    document.getElementById('invSellPanel').style.display='none';
    document.getElementById('invType').value='buy';
    document.getElementById('invPaid').value='debt';
    document.getElementById(`inv_w_1`)?.focus();
}
window.saveInvoice=()=>{
    const c=document.getElementById('invCustomer').value.trim();
    const t=document.getElementById('invType').value;
    const ps=document.getElementById('invPaid').value;
    if(!c)return toast('أدخل اسم الزبون','error');
    const newItems=[];
    for(let i=1;i<=invRows;i++){
        const w=parseInvNum(document.getElementById(`inv_w_${i}`)?.value);
        if(w<=0)continue;
        const k=parseInvNum(document.getElementById(`inv_k_${i}`)?.value||'712')||712;
        const p=parseInvNum(document.getElementById(`inv_p_${i}`)?.value);
        if(!(p>0)){ document.getElementById(`inv_p_${i}`)?.focus(); return toast(`⚠️ أدخل سعر السطر ${i} قبل الحفظ`,'error'); }
        const eq730=w*k/705,total=eq730*p;
        const bref=invRowBar[i]||null;
        newItems.push({id:uid(),w,k,is1000:k>=999,eq730,ppg:p,total,sbid:bref?.barId||null,sbt:bref?.btype||null});
    }
    if(!newItems.length)return toast('أدخل بنداً واحداً على الأقل','error');
    /* وضع التعديل: كم ستعيد الفاتورة القديمة للمخزون عند إبطالها (لفحص مخزون صحيح) */
    let _restore24=0,_restore730=0;
    const _isEdit=!!_editingInvId;
    if(_isEdit){
        const _old=invoices.find(x=>x.id===_editingInvId);
        if(_old&&_old.t==='sell')(_old.items||[]).forEach(it=>{ if(it.is1000)_restore24+=(+it.w||0); else _restore730+=(+it.w||0); });
    }
    if(t==='sell'){
        const need24=newItems.filter(i=>i.is1000&&!i.sbid).reduce((s,i)=>s+i.w,0);
        const need730=newItems.filter(i=>!i.is1000&&!i.sbid).reduce((s,i)=>s+i.w,0);
        const avail24=g24.reduce((s,b)=>s+(b.w||0),0)+_restore24;
        const avail730=g730.reduce((s,b)=>s+(b.w||0),0)+_restore730;
        if(need24>avail24+0.001)return toast(`⚠️ مخزون سبائك 24 غير كافٍ (متاح: ${fmt(avail24,2)} غ)`,'error');
        if(need730>avail730+0.001)return toast(`⚠️ مخزون 730 غير كافٍ (متاح: ${fmt(avail730,2)} غ)`,'error');
        /* فحص السبائك المحدّدة (المختارة من الكوفر): يجب أن تكون موجودة فعلاً */
        const _oldSbids=new Set();
        if(_isEdit){ const _o=invoices.find(x=>x.id===_editingInvId); if(_o&&_o.t==='sell')(_o.items||[]).forEach(it=>{ if(it.sbid)_oldSbids.add(it.sbid); }); }
        for(const it of newItems){
            if(!it.sbid)continue;
            const pool=it.sbt||'730';
            const bars=pool==='24'?g24:g730;
            const ex=bars.find(b=>b.id===it.sbid);
            const willRestore=_oldSbids.has(it.sbid);
            if(!ex&&!willRestore) return toast('🚫 هذه السبيكة لم تعد في الكوفر (بِيعت أو خرجت) — لا يمكن بيعها','error');
            if(ex&&it.w>ex.w+0.001&&!willRestore) return toast(`🚫 وزن هذه السبيكة في الكوفر ${fmt(ex.w,2)} غ فقط — لا يكفي`,'error');
        }
    }
    /* نجحت كل الفحوص → أبطِل القديمة الآن (تُستعاد الحسابات/المخزون) ثم تُبنى الجديدة */
    if(_isEdit){ _voidByInvId('invoice',_editingInvId); _editingInvId=null; if(typeof _hideEditBanner==='function')_hideEditBanner(); }
    const tp=newItems.reduce((s,b)=>s+(b.total||0),0);
    let akhd=parseInvNum(document.getElementById('invAkhd')?.value);
    if(ps==='full') akhd=tp;
    const prevBal=getCustBal(c,'دينار');
    const iid='INV-'+uid();
    const dt=new Date().toLocaleDateString('fr-FR');
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});

    /* ── حساب حركة المخزون ── */
    const barsAdd=[];
    const barsRemove=[];
    const barUpdates=[];
    const dispBars={};

    if(t==='buy'){
        newItems.forEach(item=>{
            if(!item.sbid){
                const bid=uid();
                const pool=item.is1000?'24':'730';
                barsAdd.push({id:bid,pool,w:item.w,k:item.k});
                dispBars[bid]={desc:`شراء من ${c}`,dt,src:'شراء'};
            }
        });
    }else{
        /* محاكاة إزالة المخزون على نسخة مستنسخة لتفادي التكرار */
        let g730Clone=g730.map(b=>({...b}));
        let g24Clone=g24.map(b=>({...b}));
        function pickAndRemove(pool,w){
            const bars=pool==='24'?g24Clone:g730Clone;
            let rem=w;
            for(let i=bars.length-1;i>=0&&rem>0.001;i--){
                if(bars[i].w<=rem+0.001){
                    barsRemove.push(bars[i].id);rem-=bars[i].w;bars.splice(i,1);
                }else{
                    barUpdates.push({id:bars[i].id,pool,newW:parseFloat((bars[i].w-rem).toFixed(4))});
                    bars[i].w-=rem;rem=0;
                }
            }
        }
        newItems.forEach(item=>{
            if(item.sbid){
                const pool=item.sbt||'730';
                const bars=pool==='24'?g24Clone:g730Clone;
                const ex=bars.find(b=>b.id===item.sbid);
                if(ex){
                    if(item.w>=ex.w-0.001){barsRemove.push(ex.id);bars.splice(bars.indexOf(ex),1);}
                    else{barUpdates.push({id:ex.id,pool,newW:parseFloat((ex.w-item.w).toFixed(4))});ex.w-=item.w;}
                }
            }else{
                pickAndRemove(item.is1000?'24':'730',item.w);
            }
        });
    }

    const _inv={id:iid,c,t,ps,dt,items:JSON.parse(JSON.stringify(newItems)),tp,akhd,prevBal};
    const evType=t==='buy'?'INVOICE_BUY':'INVOICE_SELL';
    emitEvent(evType,
        {c,iid,tp,akhd,prevBal,barsAdd,barsRemove,barUpdates},
        {
            invoice:_inv,
            bars:Object.keys(dispBars).length?dispBars:undefined,
            op:{c,t:t==='buy'?'شراء':'بيع',m:'دينار',a:tp,_ts:Date.now(),dt:nowStr,iid}
        }
    );
    resetInvForm();
    toast(_isEdit?'✅ تم تعديل الفاتورة وتحديث الحسابات':'✅ تم حفظ الفاتورة بنجاح');
    /* تنزيل تلقائي مُلغى */
};
window.delInv=(id)=>{
    if(!confirm('حذف هذه الفاتورة وعكس أثرها على الحسابات؟'))return;
    if(!_voidByInvId('invoice',id)){
        invoices=invoices.filter(x=>x.id!==id);
        renderArchive();
    }
    toast('🗑️ تم حذف الفاتورة','info');
};

/* ── تعديل فاتورة: تحميلها في النموذج؛ الحفظ يُبطل القديمة ويُنشئ الجديدة فتُعاد الحسابات ── */
window.editInv=(id)=>{
    const inv=invoices.find(x=>x.id===id); if(!inv)return;
    /* فواتير أصلها ليس شراء/بيع عادي (تصفية، شراء حر، مستوردة): تعديلها كفاتورة عادية
       يُنشئ سبائك جديدة دون أن يُرجع الإبطال شيئاً → تضاعف المخزون. نمنعه. */
    const _orig=(typeof _invEventType==='function')?_invEventType(id):null;
    if(_orig&&_orig!=='INVOICE_BUY'&&_orig!=='INVOICE_SELL'){
        toast('🚫 هذه الفاتورة ناتجة عن تصفية/شراء حر — لا تُعدَّل من هنا. احذف عمليتها من السجل وأعدها صحيحة','error');
        return;
    }
    if(inv.t==='buy' && typeof _invBarsConsumed==='function' && _invBarsConsumed(id)){
        toast('🚫 لا يمكن تعديل فاتورة شراء خرجت سبيكتها من الكوفر (بيعت أو دخلت رافيناج) حتى لا تتلخبط الحسابات','error');
        return;
    }
    if(!confirm('تعديل هذه الفاتورة؟ ستتغيّر الحسابات حسب التعديل بعد الحفظ.'))return;
    _editingInvId=id;
    switchPage('invoice');
    const ty=document.getElementById('invType');
    if(ty){ ty.value=inv.t; if(typeof onInvTypeChange==='function')onInvTypeChange(); }
    document.getElementById('invCustomer').value=inv.c||'';
    const items=inv.items||[];
    invRows=Math.max(6,items.length+1);
    initInvTable();
    items.forEach((it,idx)=>{
        const i=idx+1;
        const we=document.getElementById(`inv_w_${i}`), ke=document.getElementById(`inv_k_${i}`), pe=document.getElementById(`inv_p_${i}`);
        if(we)we.value=String(it.w);
        if(ke)ke.value=String(it.k);
        if(pe){ pe.value=String(it.ppg); if(typeof liveNum==='function')liveNum(pe); }
        calcInvRow(i);
    });
    const ae=document.getElementById('invAkhd'); if(ae)ae.value=(inv.akhd!=null&&inv.ps!=='full')?String(inv.akhd):'';
    const pe2=document.getElementById('invPaid'); if(pe2)pe2.value=inv.ps||'credit';
    if(typeof calcInvTotals==='function')calcInvTotals();
    _showEditBanner();
    toast('✏️ وضع التعديل — عدّل ثم احفظ','info');
};
function _showEditBanner(){
    let b=document.getElementById('invEditBanner');
    if(!b){
        b=document.createElement('div');
        b.id='invEditBanner';
        b.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;background:#7c3aed;color:#fff;border-radius:10px;padding:.45rem .8rem;display:flex;align-items:center;gap:.7rem;box-shadow:0 4px 16px rgba(124,58,237,.4);font-family:Tajawal,sans-serif;font-size:.82rem';
        document.body.appendChild(b);
    }
    b.innerHTML=`✏️ وضع تعديل الفاتورة <button onclick="cancelEditInv()" style="background:rgba(255,255,255,.25);border:none;color:#fff;border-radius:6px;padding:.2rem .65rem;font-weight:800;cursor:pointer;font-family:inherit">إلغاء</button>`;
    b.style.display='flex';
}
function _hideEditBanner(){ const b=document.getElementById('invEditBanner'); if(b)b.style.display='none'; }
window._hideEditBanner=_hideEditBanner;
window.cancelEditInv=()=>{ resetInvForm(); toast('أُلغي التعديل','info'); };

