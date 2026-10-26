// UI-only fixtures: these checks do not certify email delivery or server authentication.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:4180';
const browser=await chromium.launch({channel:process.env.TEST_BROWSER==='edge'?'msedge':'chrome'});
try {
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]) {
  const context=await browser.newContext({viewport});const page=await context.newPage();let resends=0;const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/auth/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/send-verification-email'))resends++;
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(path.endsWith('/get-session')?null:{status:true})});
  });
  await page.goto(base+'/verify-email?email=ui-only%40example.invalid');
  await page.getByRole('heading',{name:'Finish setting up your account'}).waitFor();
  assert.equal(await page.locator('.verification-guide li').count(),3);
  await page.getByText('Opened the email on your phone?',{exact:false}).waitFor();
  assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),'ui-only@example.invalid');
  await page.getByRole('button',{name:'Resend verification email',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Open the newest link, then sign in.'}).waitFor();assert.equal(resends,1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'verification guide fits viewport');
  await page.getByRole('link',{name:'I have verified my email — sign in',exact:true}).click();await page.waitForURL(base+'/login');
  await page.getByLabel('Password',{exact:true}).waitFor();
  await page.goto(base+'/login?verified=1');await page.getByText('Email verified. You can sign in.',{exact:true}).waitFor();
  await page.getByText('Use your registered email and password below.',{exact:false}).waitFor();
  await page.goto(base+'/login?verified=1&error=invalid_token');
  await page.getByRole('alert').filter({hasText:'invalid or expired'}).waitFor();
  assert.equal(await page.getByText('Email verified. You can sign in.',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);console.log('PASS verification instructions, resend, sign-in link, success/error feedback at width '+viewport.width);
  await context.close();
 }
}finally{await browser.close();}