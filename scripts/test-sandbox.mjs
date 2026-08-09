import { chromium } from 'playwright';
import fs from 'fs';
const BASE = 'http://localhost:3000';

(async () => {
  const tRes = await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13338183337',password:'123456'})});
  const {token} = await tRes.json();
  const origHtml = fs.readFileSync('/var/folders/w6/lklfy38j7w3cjf0j0g0py4vc0000gn/T/codebuddy-dropped-files/5acec7b5-bda3-4570-b911-f15fef7cd1b5/三角形面积_·_交互式理解-html-20260729.html','utf-8');
  const cRes = await fetch(BASE+'/api/exploration-activities',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({subProjectId:'cms5xkah70002me8tgwtxh9oi',title:'a'+Date.now(),htmlContent:origHtml,enableAiCompanion:true})});
  const exp = await cRes.json();
  const gRes = await fetch(BASE+'/api/exploration-activities/'+exp.id,{headers:{Authorization:'Bearer '+token}});
  const gData = await gRes.json();
  const injected = gData.htmlContent;

  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror',e=>errs.push('PAGE:'+e.message));
  page.on('console',m=>{if(m.type()==='error')errs.push('CONS:'+m.text())});

  await page.setContent('<html><body><iframe id=a srcDoc="" sandbox="allow-scripts" style="width:500px;height:300px"></iframe><iframe id=b srcDoc="" sandbox="allow-scripts allow-same-origin" style="width:500px;height:300px"></iframe></body></html>');
  await page.evaluate(html=>{document.getElementById('a').srcdoc=html;document.getElementById('b').srcdoc=html;},injected);
  await new Promise(r=>setTimeout(r,3000));
  const r = await page.evaluate(()=>{
    const fa=document.getElementById('a').contentWindow;
    const fb=document.getElementById('b').contentWindow;
    return {
      aBase:fa?.document?.getElementById('baseVal')?.textContent,
      bBase:fb?.document?.getElementById('baseVal')?.textContent,
      aCanvas:fa?.document?.getElementById('triangleCanvas') ? 'YES' : 'NO',
      bCanvas:fb?.document?.getElementById('triangleCanvas') ? 'YES' : 'NO',
    };
  });
  console.log('A (allow-scripts only):', r.aBase, r.aCanvas);
  console.log('B (with allow-same-origin):', r.bBase, r.bCanvas);
  console.log('errors:', errs.slice(0,3).join(' | ') || 'none');
  await fetch(BASE+'/api/exploration-activities/'+exp.id,{method:'DELETE',headers:{Authorization:'Bearer '+token}});
  await browser.close();
})().catch(e=>console.error(e.message));