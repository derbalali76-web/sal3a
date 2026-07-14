/* ═══════════ RAFFINAGE ═══════════ */
let rafRows=6;
const _rafSentIds=new Set();
function rafInputRow(i){
    return`<tr>
        <td class="inv-rn">${i}</td>
        <td><input type="text" inputmode="decimal" class="inv-ci" id="rafW_${i}" placeholder="" autocomplete="off"
            oninput="calcRaf();if(${i}===rafRows&&this.value.trim()&&rafRows<300)addRafRow(true)" onkeydown="rafNav(event,${i},'w')"></td>
        <td><input type="text" inputmode="decimal" class="inv-ci" id="rafK_${i}" autocomplete="new-password"
            oninput="calcRaf()" onkeydown="rafNav(event,${i},'k')"></td>
        <td class="raf-pure-cell" id="rafPure_${i}"></td>
    </tr>`;
}
window.rafNav=(e,row,col)=>{
    const order=['w','k'];
    const ci=order.indexOf(col);
    const gel=(c,r)=>document.getElementById((c==='w'?'rafW_':'rafK_')+r);
    if(e.key==='Enter'||e.key==='Tab'){
        e.preventDefault();
        if(col==='w')gel('k',row)?.focus();
        else if(row<rafRows)gel('w',row+1)?.focus();
        else addRafRow();
    }else if(e.key==='ArrowDown'){
        e.preventDefault();
        if(row<rafRows)gel(col,row+1)?.focus();
    }else if(e.key==='ArrowUp'){
        e.preventDefault();
        if(row>1)gel(col,row-1)?.focus();
    }else if(e.key==='ArrowRight'){
        /* RTL: يمين = عمود سابق (الوزن يمين العيار) */
        e.preventDefault();
        if(ci>0)gel(order[ci-1],row)?.focus();
    }else if(e.key==='ArrowLeft'){
        /* RTL: يسار = عمود تالي */
        e.preventDefault();
        if(ci<order.length-1)gel(order[ci+1],row)?.focus();
    }
};
window.addRafRow=function(noFocus){
    rafRows++;
    const tbody=document.getElementById('rafTableBody');
    tbody.insertAdjacentHTML('beforeend',rafInputRow(rafRows));
    if(!noFocus)document.getElementById('rafW_'+rafRows)?.focus();
};
window.initRafTable=()=>{
    rafRows=10;
    let h='';for(let i=1;i<=rafRows;i++)h+=rafInputRow(i);
    document.getElementById('rafTableBody').innerHTML=h;
};
window.showRafBalance=()=>calcRaf();
function _checkRafDupes(){
    const seen={};
    for(let i=1;i<=rafRows;i++){
        const w=parseFloat(document.getElementById('rafW_'+i)?.value)||0;
        if(!w)continue;
        const k=parseFloat(document.getElementById('rafK_'+i)?.value)||730;
        const key=`${Math.round(w*1000)}|${Math.round(k*10)}`;
        (seen[key]=seen[key]||[]).push(i);
    }
    const rows=document.querySelectorAll('#rafTableBody tr');
    rows.forEach((tr,idx)=>{
        const i=idx+1;
        const w=parseFloat(document.getElementById('rafW_'+i)?.value)||0;
        const k=parseFloat(document.getElementById('rafK_'+i)?.value)||730;
        const key=`${Math.round(w*1000)}|${Math.round(k*10)}`;
        const isDup=w>0&&seen[key]&&seen[key].length>1;
        tr.style.background=isDup?'rgba(239,68,68,.13)':'';
        tr.style.outline=isDup?'1.5px solid rgba(239,68,68,.4)':'';
        tr.title=isDup?'⚠️ وزن وعيار مكرر!':'';
    });
}
window.calcRaf=()=>{
    const c=document.getElementById('rafCustomer').value.trim();
    let totalPure=0,totalW=0,totalEq730=0;
    for(let i=1;i<=rafRows;i++){
        const w=parseFloat(document.getElementById('rafW_'+i)?.value)||0;
        const k=parseFloat(document.getElementById('rafK_'+i)?.value)||730;
        const pure=w*k/1000;
        totalW+=w;totalPure+=pure;totalEq730+=w*k/730;
        const cell=document.getElementById('rafPure_'+i);
        if(cell)cell.textContent=pure>0?fmt(pure,2):'';
    }
    const feeRate=parseFloat(document.getElementById('rafFee')?.value)||0;
    /* خاصية «عثمان»: الأجرة على وزن المكافئ 730 بدل الوزن الحقيقي */
    const _isOthman=c.replace(/\s+/g,'')==='عثمان';
    const feeW=_isOthman?totalEq730:totalW;
    const totalDinar=feeW*feeRate;
    const sawared=parseFloat(document.getElementById('rafSawared')?.value)||0;
    const lanqo=parseFloat(document.getElementById('rafLanqo')?.value)||0;
    const prevDinar=c?getCustBal(c,'دينار'):0;
    const prevGold=c?getCustBal(c,'ذهب 24'):0;
    const finalDinar=-totalDinar+sawared+prevDinar;
    const finalGold=totalPure-lanqo+prevGold;
    document.getElementById('rafDinarTotal').textContent=fmt(totalDinar,0);
    document.getElementById('rafPureTotal').textContent=fmt(totalPure,2)+' غ';
    document.getElementById('rafPrevDinarDisp').textContent=fmt(prevDinar,0);
    document.getElementById('rafPrevGoldDisp').textContent=fmt(prevGold,2)+' غ';
    document.getElementById('rafFinalDinar').textContent=fmt(finalDinar,0);
    const gEl=document.getElementById('rafFinalGold');
    gEl.textContent=fmt(finalGold,2)+' غ';
    gEl.style.color=finalGold>=0?'var(--gr)':'var(--rd)';
    const d=document.getElementById('rafDate');
    if(d)d.textContent=new Date().toLocaleDateString('fr-FR');
    _checkRafDupes();
};
window.saveSimpleRaf=()=>{
    const c=document.getElementById('rafCustomer').value.trim();
    if(!c)return toast('أدخل اسم الزبون أو المصفى','error');
    let totalSentW=0,totalSentEq24=0,totalSentEq730=0;
    const rows=[];
    for(let i=1;i<=rafRows;i++){
        const w=parseFloat(document.getElementById('rafW_'+i)?.value)||0;
        const k=parseFloat(document.getElementById('rafK_'+i)?.value)||730;
        if(w>0){totalSentW+=w;totalSentEq24+=w*k/1000;totalSentEq730+=w*k/730;rows.push({w,k,pure:w*k/1000});}
    }
    if(totalSentW<=0)return toast('أدخل وزن الكسر المرسل','error');
    const avail730=g730.reduce((s,b)=>s+(b.w||0),0);
    if(totalSentW>avail730+0.001)return toast(`⚠️ مخزون 730 غير كافٍ (متاح: ${fmt(avail730,2)} غ)`,'error');
    const feeRate=parseFloat(document.getElementById('rafFee')?.value)||0;
    if(feeRate<=0)return toast('أدخل سعر الأجرة (دج/غ)','error');
    /* خاصية «عثمان»: الأجرة على وزن المكافئ 730 */
    const _isOthman=c.replace(/\s+/g,'')==='عثمان';
    const feeW=_isOthman?totalSentEq730:totalSentW;
    const totalDinar=feeW*feeRate;
    const sawared=parseFloat(document.getElementById('rafSawared')?.value)||0;
    const lanqo=parseFloat(document.getElementById('rafLanqo')?.value)||0;
    const prevD=getCustBal(c,'دينار');
    const prevG=getCustBal(c,'ذهب 24');
    const finalDinar=-totalDinar+sawared+prevD;
    const finalGold=totalSentEq24-lanqo+prevG;
    /* حركة المخزون — مطابقة كل صفّ مع سبيكته:
       ① صف يطابق سبيكة تماماً (وزن+عيار) → تُحذف كاملة.
       ② صف وزنه أقلّ من سبيكة بنفس العيار → تُقصّ منها والباقي يبقى بعيارها.
       ③ السبائك التي لا صفوف لها تبقى سليمة. والفائض غير المطابق يُقتطع احتياطاً بالترتيب. */
    const barsRemove730=[], barUpdates730=[];
    {
        const used=new Set();
        let rem=totalSentW;
        const takeFull=bar=>{used.add(bar.id);barsRemove730.push(bar.id);rem=parseFloat((rem-bar.w).toFixed(4));};
        const takePart=(bar,w)=>{used.add(bar.id);barUpdates730.push({id:bar.id,pool:'730',newW:parseFloat((bar.w-w).toFixed(4))});rem=parseFloat((rem-w).toFixed(4));};
        const kEq=(a,b)=>Math.round(a||730)===Math.round(b||730);
        const pool=pred=>g730.filter(b=>pred(b)&&!used.has(b.id));
        /* ① مطابقة تامة (وزن+عيار) — المختارة أولاً ثم البقية */
        rows.forEach(r=>{
            let bar=pool(b=>_rafSentIds.has(b.id)&&Math.abs((b.w||0)-r.w)<0.005&&kEq(b.k,r.k))[0]
                 ||pool(b=>Math.abs((b.w||0)-r.w)<0.005&&kEq(b.k,r.k))[0];
            if(bar){r._done=true;takeFull(bar);}
        });
        /* ② قصّ جزئي من سبيكة بنفس العيار تسع الوزن — المختارة أولاً */
        rows.forEach(r=>{
            if(r._done)return;
            let bar=pool(b=>_rafSentIds.has(b.id)&&kEq(b.k,r.k)&&(b.w||0)>=r.w-0.005)[0]
                 ||pool(b=>kEq(b.k,r.k)&&(b.w||0)>=r.w-0.005)[0];
            if(bar){r._done=true;
                if(Math.abs(bar.w-r.w)<0.005)takeFull(bar);else takePart(bar,r.w);
            }
        });
        /* ③ الفائض غير المطابق (صفوف بلا سبيكة) يُقتطع بالترتيب */
        const _consume=list=>{
            for(let i=0;i<list.length && rem>0.001;i++){
                const bar=list[i];
                if(used.has(bar.id))continue;
                if(bar.w<=rem+0.001)takeFull(bar);
                else{takePart(bar,rem);}
            }
        };
        if(rem>0.001)_consume(g730.filter(b=>_rafSentIds.has(b.id)));
        if(rem>0.001)_consume(g730.filter(b=>!_rafSentIds.has(b.id)));
    }
    const barsAdd24=[];
    const dispBars={};
    const dt=new Date().toLocaleDateString('fr-FR');
    if(lanqo>0){
        const bid=uid();
        barsAdd24.push({id:bid,pool:'24',w:lanqo,k:1000});
        dispBars[bid]={desc:'رافيناج - استلام لانقو',dt,src:'رافيناج'};
    }
    const rid='RAF-'+uid();
    const nowStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    const _raf={id:rid,c,rows,sentW:totalSentW,eq24:totalSentEq24,fee:totalDinar,feeRate,feeW:_isOthman?feeW:undefined,sawared,lanqo,prevD,prevG,finalDinar,finalGold,dt};
    emitEvent('RAF',
        {c,rid,rows,totalSentW,eq24:totalSentEq24,feeRate,feeW:_isOthman?feeW:undefined,totalDinar,fee:totalDinar,sawared,lanqo,prevD,prevG,barsRemove730,barUpdates730,barsAdd24},
        {
            rafInvoice:_raf,
            bars:Object.keys(dispBars).length?dispBars:undefined,
            op:{c,t:'رافيناج',m:'ذهب 24',a:totalSentEq24,_ts:Date.now(),dt:nowStr,sentW:totalSentW,rec24:lanqo,fee:totalDinar,prevD,prevG,rid}
        }
    );
    window._editRestore=null;
    if(typeof _hideRafEditBanner==='function')_hideRafEditBanner();
    resetRafForm();
    toast('🔥 تم حفظ الرافيناج بنجاح');
    /* تنزيل تلقائي مُلغى */
};
window.resetRafForm=()=>{
    _rafSentIds.clear();
    document.getElementById('rafCustomer').value='';
    const _rbb=document.getElementById('rafBalBox');if(_rbb)_rbb.style.display='none';
    initRafTable();
    ['rafFee','rafSawared','rafLanqo'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='0';});
    ['rafDinarTotal','rafPureTotal','rafPrevDinarDisp','rafPrevGoldDisp'].forEach(id=>{
        const el=document.getElementById(id);if(el)el.textContent='0';
    });
    document.getElementById('rafFinalDinar').textContent='0';
    document.getElementById('rafFinalGold').textContent='0,00 غ';
};


/* ═══ PDF الرافيناج ═══ */
function buildRafHtml(r){
    const n=(r.rows||[]).length;
    /* حجم الخط يتقلص تلقائياً كلما زادت الأسطر حتى تتسع كلها في A4 */
    const fs=n<=8?15:n<=14?13:n<=20?11:n<=28?9.5:8;
    const pd=n<=8?7:n<=14?5:n<=20?3.5:n<=28?2.5:2;
    const hdr=n<=8?22:n<=14?18:16;
    const tot=n<=8?18:n<=14?15:13;
    const fin=n<=8?24:n<=14?20:16;
    return`<div style="position:relative;overflow:hidden;padding:14px 18px;font-family:Tajawal,sans-serif;direction:rtl;width:190mm;box-sizing:border-box">
        ${typeof _wmLayer==='function'?_wmLayer():''}
        <div style="position:relative;z-index:1">
        <div style="text-align:center;border-bottom:2px solid #c2410c;padding-bottom:8px;margin-bottom:10px">
            <div style="font-size:${hdr+4}px;font-weight:900;color:#c2410c">🔥 فاتورة رافيناج</div>
            <div style="font-size:${hdr-2}px;color:#555">${r.c} — ${r.dt}</div>
        </div>
        <table border="1" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-color:#aaa;margin-bottom:8px">
            <thead><tr style="background:#1a1a1a;color:#fff;font-weight:800;font-size:${fs+1}px">
                <th style="padding:${pd}px ${pd+2}px;border:1px solid #555;width:8%">#</th>
                <th style="padding:${pd}px ${pd+2}px;border:1px solid #555">الوزن (غ)</th>
                <th style="padding:${pd}px ${pd+2}px;border:1px solid #555">العيار</th>
                <th style="padding:${pd}px ${pd+2}px;border:1px solid #555">خالص (غ)</th>
            </tr></thead>
            <tbody>
                ${(r.rows||[]).map((row,i)=>`<tr style="text-align:center;background:${i%2?'#f9f9f9':'#fff'}">
                    <td style="border:1px solid #ccc;padding:${pd}px;color:#888;font-size:${fs-1}px">${i+1}</td>
                    <td style="border:1px solid #ccc;padding:${pd}px;font-size:${fs+2}px;font-weight:700">${fmt(row.w,2)}</td>
                    <td style="border:1px solid #ccc;padding:${pd}px;font-size:${fs+2}px;font-weight:700">${row.k}</td>
                    <td style="border:1px solid #ccc;padding:${pd}px;font-size:${fs+4}px;font-weight:900">${fmt(row.pure,3)}</td>
                </tr>`).join('')}
                <tr style="background:#e5e5e5;text-align:center;font-weight:900">
                    <td style="border:1px solid #777;padding:${pd+1}px;font-size:${tot-2}px">المجموع</td>
                    <td style="border:1px solid #777;padding:${pd+1}px;font-size:${tot+2}px">${fmt(r.sentW,2)}</td>
                    <td style="border:1px solid #777;padding:${pd+1}px;font-size:${tot}px">—</td>
                    <td style="border:1px solid #777;padding:${pd+1}px;font-size:${tot+4}px">${fmt(r.eq24,3)}</td>
                </tr>
            </tbody>
        </table>
        <div style="font-size:${tot}px;border:1px solid #aaa;padding:${pd+4}px ${pd+6}px;border-radius:4px">
            ${r.feeW?`<div style="display:flex;justify-content:space-between;margin-bottom:${pd}px"><span>وزن الأجرة (مكافئ 730):</span><span style="font-size:${tot+2}px;font-weight:700">${fmt(r.feeW,2)} غ</span></div>`:''}
            <div style="display:flex;justify-content:space-between;margin-bottom:${pd}px"><span>الأجرة (دج/غ):</span><span style="font-size:${tot+2}px;font-weight:700">${fmt(r.feeRate,0)}</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:${pd}px"><span>قيمة دج:</span><span style="font-size:${tot+4}px;font-weight:900">${fmt(r.fee,0)} دج</span></div>
            ${r.sawared>0?`<div style="display:flex;justify-content:space-between;margin-bottom:${pd}px"><span>دفع صوارد:</span><span style="font-size:${tot+2}px;font-weight:700">${fmt(r.sawared,0)} دج</span></div>`:''}
            ${r.lanqo>0?`<div style="display:flex;justify-content:space-between;margin-bottom:${pd}px"><span>دفع لانقو:</span><span style="font-size:${tot+2}px;font-weight:700">${fmt(r.lanqo,2)} غ</span></div>`:''}
            ${(r.prevD&&r.prevD!==0)?`<div style="display:flex;justify-content:space-between;margin-bottom:${pd}px"><span>رصيد دينار سابق:</span><span style="font-size:${tot+2}px;font-weight:700">${fmt(r.prevD,0)} دج</span></div>`:''}
            ${(r.prevG&&r.prevG!==0)?`<div style="display:flex;justify-content:space-between;margin-bottom:${pd}px"><span>رصيد ذهب سابق:</span><span style="font-size:${tot+2}px;font-weight:700">${fmt(r.prevG,3)} غ</span></div>`:''}
            <div style="display:flex;justify-content:space-between;border-top:2px solid #777;padding-top:${pd+2}px;font-weight:900">
                <span style="font-size:${tot}px;align-self:center">النهائي دينار:</span><span style="font-size:${fin}px">${fmt(r.finalDinar,0)} دج</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-weight:900">
                <span style="font-size:${tot}px;align-self:center">النهائي ذهب 24:</span><span style="font-size:${fin}px">${fmt(r.finalGold,3)} غ</span>
            </div>
        </div>
        <div style="text-align:center;margin-top:${pd+4}px;font-size:11px;color:#666">توقيع: _______________</div>
        </div>
    </div>`;
}
const _rafPdfOpts=(r)=>({
    margin:[6,8,6,8],
    filename:`رافيناج_${r.c}_${r.dt}.pdf`,
    image:{type:'jpeg',quality:.98},
    html2canvas:{scale:2,useCORS:true},
    jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}
});
window.printRaf=(id)=>{
    const r=rafInvoices.find(x=>x.id===id);if(!r)return;
    if(typeof _makeLockedPdf==='function') _makeLockedPdf(_rafPdfOpts(r),buildRafHtml(r));
    else { html2pdf().set(_rafPdfOpts(r)).from(buildRafHtml(r)).save(); toast('📄 تم إنشاء PDF','info'); }
};
window.waRaf=(id)=>{
    const r=rafInvoices.find(x=>x.id===id);if(!r)return;
    const fname=`رافيناج_${r.c}_${r.dt}.pdf`;
    toast('⏳ جارٍ تحضير PDF…','info');
    html2pdf().set(_rafPdfOpts(r)).from(buildRafHtml(r)).outputPdf('blob')
        .then(blob=>{ _showShareCard(blob,fname,`رافيناج ${r.c}`); })
        .catch(e=>toast('❌ خطأ في توليد PDF: '+(e&&e.message||e),'error'));
};
window.delRaf=(id)=>{
    if(!confirm('حذف هذه الفاتورة وعكس أثرها؟'))return;
    if(!_voidByInvId('rafInvoice',id)){
        rafInvoices=rafInvoices.filter(x=>x.id!==id);
        renderArchive();
    }
    toast('🗑️ تم الحذف','info');
};

