import assert from "node:assert/strict";

// Runs only inside the disposable keyboard fixture, against its synthetic bridge.
export async function checkMailboxVisits({ window, evaluate, until, click, fill, press, url }) {
  const setup = `(() => {
    window.visitClock = Date.now(); window.visitNow = window.visitClock;
    Date.now = () => window.visitNow;
    window.visitKey = 'hey-agent:paper-trail-visit:v1:' + window.heyAgent.profiles.current.active.key;
    window.visitNewRows = false; window.visitUnavailable = false;
    const list = window.heyAgent.mail.listMailbox;
    window.heyAgent.mail.listMailbox = async box => {
      const result = await list(box);
      if (box !== 'trailbox') return result;
      if (window.visitUnavailable) return { ...result, boxName: 'Paper Trail', status: 'unavailable', detail: 'Synthetic unavailable mailbox', postings: [] };
      return { ...result, boxName: 'Paper Trail', postings: result.postings.slice(0,4).map((row,i)=>({ ...row, seen:true, createdAt:new Date(window.visitClock + (window.visitNewRows && i < 2 ? 1000 : -10000-i*1000)).toISOString() })) };
    };
  })()`;
  const navigate = async (key) => { await evaluate("document.activeElement.blur()"); await press(key); };
  const stored = () => evaluate("localStorage.getItem(window.visitKey)");
  const divider = "document.querySelector('.mail-visit-divider')";
  await navigate("1");
  await evaluate(setup);
  await window.webContents.executeJavaScript("window.heyAgent.mail.listMailbox('trailbox')");
  assert.equal(await stored(), null, "prefetch does not count as a visit");
  await navigate("3");
  await until("document.querySelector('.imbox-titlebar h1')?.textContent==='Paper Trail' && localStorage.getItem(window.visitKey)!==null");
  assert.equal(await evaluate(`Boolean(${divider})`), false, "first visit has no invented new mail");
  const first = await stored();
  await navigate("1");
  await evaluate("window.visitNewRows=true; window.visitNow+=2000");
  await navigate("3");
  await until(`Boolean(${divider})`);
  const second = await stored();
  assert.notEqual(first, second);
  assert.equal(await evaluate(`Array.from(${divider}.parentElement.children).slice(0, Array.from(${divider}.parentElement.children).indexOf(${divider})).filter(node => node.matches('.mail-row')).length`), 2, "two new conversations precede the boundary; day headings do not count as mail");
  await evaluate("window.visitNow+=2000");
  await click('[aria-label="Refresh Paper Trail"]');
  await until("!document.querySelector('[aria-label=\"Refresh Paper Trail\"]').disabled");
  assert.equal(await stored(), second, "refresh leaves visit timestamp alone");
  assert.equal(await evaluate(`Boolean(${divider})`), true);
  await click('.mail-row');
  await until("document.querySelector('.imbox-panel')?.hidden===true");
  await press("Escape");
  await until("document.querySelector('.imbox-panel')?.hidden===false");
  assert.equal(await stored(), second, "reading a thread is still the same visit");
  assert.equal(await evaluate(`Boolean(${divider})`), true);
  await fill('.mail-search input', 'synthetic-filter');
  assert.equal(await evaluate(`Boolean(${divider})`), false, "filters hide the boundary");
  await fill('.mail-search input', '');
  await until(`Boolean(${divider})`);

  await navigate("1");
  await navigate("3");
  await until("document.querySelector('.imbox-titlebar h1')?.textContent==='Paper Trail'");
  assert.equal(await evaluate(`Boolean(${divider})`), false, "next visit advances the boundary");
  const third = await stored();
  await navigate("1");
  await evaluate("window.visitUnavailable=true; window.visitNow+=2000");
  await navigate("3");
  await until("document.querySelector('.empty-state h2')?.textContent==='Mailbox unavailable'");
  assert.equal(await stored(), third, "failed load is not a visit");
  await evaluate("window.visitUnavailable=false");
  await click('[aria-label="Refresh Paper Trail"]');
  await until("document.querySelectorAll('.mail-row').length===4");
  assert.notEqual(await stored(), third);

  // A reload uses persisted state, not a mounted component's ref. Light/compact
  // rendering uses the same stored boundary and synthetic arrival arrangement.
  window.setSize(1000, 800);
  await window.loadURL(url.replace("theme=dusk", "theme=dawn"));
  await until("Boolean(window.heyAgent && document.querySelector('.mail-row'))");
  await evaluate(setup);
  await evaluate("window.visitClock=Number(localStorage.getItem(window.visitKey))+1000;window.visitNewRows=true;window.visitNow=window.visitClock+2000");
  await navigate("3");
  await until(`Boolean(${divider})`);
  assert.equal(await evaluate("document.documentElement.scrollWidth<=window.innerWidth"), true);
  console.log("Paper Trail smoke passed: first visit, prefetch, new arrivals, fixed refresh/read cutoff, filtering, revisit, unavailable load, persistence and compact layout. Synthetic data only.");
}
