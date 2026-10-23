// Local development mailbox only. Never expose Mailpit through a public tunnel.
export async function verifyTestAccount(email, page) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const list = await (await fetch('http://127.0.0.1:8025/api/v1/messages')).json();
    const message = list.messages?.find(message => message.To?.some(to => to.Address === email) && /Verify/.test(message.Subject));
    if (message) {
      const detail = await (await fetch('http://127.0.0.1:8025/api/v1/message/' + message.ID)).json();
      const url = detail.Text.match(/https?:[^\s]+/)[0];
      await page.goto(url);
      return message.ID;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Verification email did not reach local Mailpit');
}