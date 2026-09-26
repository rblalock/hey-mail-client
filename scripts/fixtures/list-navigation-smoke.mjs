import assert from "node:assert/strict";

export async function checkListNavigation({ window, url, evaluate, until, click, fill, press }) {
  const fresh = async () => {
    await evaluate('localStorage.clear()');
    await window.loadURL(url);
    await until("Boolean(window.heyAgent && document.querySelector('.mail-row'))");
    await evaluate("window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);window.cancelAnimationFrame=clearTimeout;true");
  };
  const focus = async (selector) => evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); node.focus(); node.dispatchEvent(new FocusEvent('focusin',{bubbles:true})); })()`);
  // Mail rows must open from their actual key handler, with no artificial click.
  // Other native controls still use a modeled default in this DOM-only check.
  const enter = async () => evaluate(`(() => {
    const target=document.activeElement;
    const unhandled=target.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}));
    if (target.matches('button[data-posting-id]')) {
      if (unhandled) throw new Error('Mail-row Enter was not handled; do not substitute a click.');
    } else if (unhandled && target.matches('button')) target.click();
  })()`);
  const back = async () => {
    await evaluate("(() => { const panel=document.querySelector('.thread-panel'); panel.tabIndex=-1; panel.focus(); })()");
    await press('Escape');
    await until("!document.querySelector('.thread-panel')");
  };

  await fresh();
  // Tab/assistive focus must update the mailbox cursor before X or J/K.
  await focus('.mail-row:nth-of-type(3)');
  const focusedMail = await evaluate('document.activeElement.dataset.postingId');
  await until(`document.querySelector('.mail-row[data-selected=true]')?.dataset.postingId === ${JSON.stringify(focusedMail)}`);
  await press('x');
  assert.equal(await evaluate("document.querySelector('.mail-row[data-bulk-selected=true]').dataset.postingId"), focusedMail);

  await fresh();
  // Check focus transfer from controls and at list edges. This DOM test does not
  // prove native Enter activation; that requires separate browser verification.
  for (const [key, modifiers] of [['j', []], ['k', []], ['ArrowDown', []], ['ArrowUp', []], ['J', ['shift']], ['K', ['shift']], ['ArrowDown', ['shift']], ['ArrowUp', ['shift']]]) {
    await focus('.sidebar-toggle');
    await press(key, modifiers);
    assert.equal(await evaluate("document.activeElement.matches('.mail-row[data-selected=true]')"), true, `${key} must transfer focus to the highlighted mail row`);
  }
  for (const [edge, key] of [['first', 'k'], ['last', 'j']]) {
    const idAtEdge = await evaluate(`[...document.querySelectorAll('.mail-row')].at(${edge === 'first' ? 0 : -1}).dataset.postingId`);
    await focus(`.mail-row[data-posting-id="${idAtEdge}"]`);
    const id = await evaluate('document.activeElement.dataset.postingId');
    await until(`document.querySelector('.mail-row[data-selected=true]')?.dataset.postingId === ${JSON.stringify(id)}`);
    await focus('.sidebar-toggle');
    await press(key);
    assert.equal(await evaluate('document.activeElement.dataset.postingId'), id, `${key} must transfer focus even at the list edge`);
  }

  await fresh();
  await evaluate('document.activeElement.blur()'); await press('k', ['control']);
  await until("Boolean(document.querySelector('#command-palette-input'))");
  await fill('#command-palette-input', 'Go to Paper Trail');
  await focus('[aria-label="Close commands"]'); await press('ArrowDown');
  assert.equal(await evaluate('document.activeElement.id'), 'command-palette-input');
  await enter(); await until("document.querySelector('.nav-row[data-active=true]')?.textContent === 'Paper Trail'");
  // A focused option must not retain native activation after keyboard movement.
  await evaluate('document.activeElement.blur()'); await press('k', ['control']);
  await fill('#command-palette-input', 'Go to');
  await focus('.command-results button'); await press('End');
  assert.equal(await evaluate('document.activeElement.id'), 'command-palette-input');
  await focus('#command-nav-imbox');
  await evaluate("document.querySelector('#command-nav-trail').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))");
  await until("document.querySelector('#command-nav-trail')?.getAttribute('aria-selected') === 'true'");
  await enter(); await until("document.querySelector('.nav-row[data-active=true]')?.textContent === 'Paper Trail'");

  await fresh();
  await evaluate(`(() => {
    const list=window.heyAgent.mail.listMailbox;
    window.heyAgent.mail.listMailbox=async box=>{const result=await list(box);return {...result,postings:result.postings.map((row,i)=>i===0?{...row,kind:'bundle'}:row)}};
  })()`);
  await evaluate('document.activeElement.blur()'); await press('2');
  await until("Boolean(document.querySelector('.mail-row'))"); await click('.mail-row');
  await until("document.querySelectorAll('.thread-listing-row').length >= 3");
  await focus('.thread-listing-row:nth-child(2)');
  const bundleRow = await evaluate('document.activeElement.dataset.postingId');
  const bundleSubject = await evaluate("document.activeElement.querySelector('strong').textContent");
  await until(`document.querySelector('.thread-listing-row[aria-selected=true]')?.dataset.postingId === ${JSON.stringify(bundleRow)}`);
  await enter(); await until(`document.querySelector('.thread-panel h1')?.textContent === ${JSON.stringify(bundleSubject)}`);
  await back();
  await until(`document.activeElement.dataset.postingId === ${JSON.stringify(bundleRow)}`);
  await enter(); await until(`document.querySelector('.thread-panel h1')?.textContent === ${JSON.stringify(bundleSubject)}`);
  await back();
  await until(`document.activeElement.dataset.postingId === ${JSON.stringify(bundleRow)}`);
  await focus(`.thread-listing-row[data-posting-id="${bundleRow}"]`);
  await press('j');
  const nextSubject = await evaluate("document.activeElement.querySelector('strong').textContent");
  assert.notEqual(nextSubject, bundleSubject);
  await enter(); await until(`document.querySelector('.thread-panel h1')?.textContent === ${JSON.stringify(nextSubject)}`);
  await back();
  await focus('.thread-listing-header .calendar-back'); await enter();
  await until("!document.querySelector('.thread-listing-panel') && !document.querySelector('.thread-panel')");

  // Search and contact history use native focused buttons, not a second cursor.
  await fresh(); await evaluate('document.activeElement.blur()'); await press('/');
  await fill('[aria-label="Search all email"]', 'a'); await press('Enter');
  await until("document.querySelectorAll('.mail-search-results [data-posting-id]').length >= 2");
  for (const index of [1, 2]) {
    await focus(`.mail-search-results [data-posting-id]:nth-child(${index})`);
    const subject = await evaluate("document.activeElement.querySelector('strong').textContent");
    await enter(); await until(`document.querySelector('.thread-panel h1')?.textContent === ${JSON.stringify(subject)}`);
    await back();
  }
  await press('Escape');
  await evaluate("[...document.querySelectorAll('nav button')].find(button=>button.textContent==='Library').click()");
  await until("Boolean(document.querySelector('.library-contact-row'))"); await click('.library-contact-row');
  await until("document.querySelectorAll('.library-conversations [data-posting-id]').length >= 2");
  for (const index of [1, 2]) {
    await focus(`.library-conversations [data-posting-id]:nth-child(${index})`);
    const subject = await evaluate("document.activeElement.querySelector('strong').textContent");
    await enter(); await until(`document.querySelector('.thread-panel h1')?.textContent === ${JSON.stringify(subject)}`);
    await back();
  }

  await fresh(); await evaluate("localStorage.setItem('hey-agent:calendar-date','2026-09-02');document.activeElement.blur()"); await press('0');
  await until("document.querySelectorAll('.calendar-event').length >= 2");
  for (const key of ['j', 'k', 'ArrowDown', 'ArrowUp']) {
    await focus('.calendar-event'); await enter();
    await until("Boolean(document.querySelector('.calendar-detail'))"); await press('Escape');
    await until("document.activeElement.matches('.calendar-event')"); await press(key);
    assert.equal(await evaluate("document.activeElement.dataset.highlighted"), 'true');
    const title = await evaluate("document.activeElement.querySelector('strong').textContent");
    await enter(); await until(`document.querySelector('.calendar-detail h1')?.textContent === ${JSON.stringify(title)}`);
    await press('Escape'); await until("!document.querySelector('.calendar-detail')");
  }
  await focus('.calendar-event');
  await evaluate("document.querySelectorAll('.calendar-event')[1].dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))");
  assert.equal(await evaluate('document.activeElement.dataset.highlighted'), 'true');
  const focusedEvent = await evaluate("document.activeElement.querySelector('strong').textContent");
  await enter(); await until(`document.querySelector('.calendar-detail h1')?.textContent === ${JSON.stringify(focusedEvent)}`);
  await press('Escape'); await until("!document.querySelector('.calendar-detail')");
  await click('[aria-label="Search Calendar"]');
  await fill('.calendar-search input', 'a'); await click('.calendar-search-submit');
  await until("document.querySelectorAll('.calendar-search-result').length >= 2");
  await focus('.calendar-search-result'); await press('j');
  assert.equal(await evaluate('document.activeElement.dataset.current'), 'true');
  await press('k');
  assert.equal(await evaluate('document.activeElement.dataset.current'), 'true');
  await press('Escape');

  // Menus use actual focused items; arrows must not leave the trigger active.
  await click('[aria-label="Calendar Helpers"]');
  await until("Boolean(document.activeElement.closest('.helper-menu-items'))");
  await press('ArrowDown');
  assert.equal(await evaluate('document.activeElement.getAttribute("role")'), 'menuitem');
  await press('Escape');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Calendar Helpers');

  await fresh(); await click('[data-tooltip="Compose a message"]');
  await fill('[aria-label="To recipients"]', 'a');
  await until("document.querySelectorAll('.recipient-suggestions [role=option]').length >= 2");
  await press('ArrowDown');
  const email = await evaluate("document.querySelector('.recipient-suggestions [aria-selected=true] small').textContent");
  await press('Enter');
  await until(`document.querySelector('.recipient-chip')?.title === ${JSON.stringify(email)}`);
  assert.equal(await evaluate("Boolean(document.querySelector('.mail-composer-dialog'))"), true);
  await click('[aria-label="Close composer"]');

  await focus('.agent-tab'); await press('ArrowRight');
  await until("document.activeElement.matches('.agent-tab[aria-selected=true]')");
  await press('ArrowLeft'); await until("document.activeElement.matches('.agent-tab[aria-selected=true]')");

  await fresh(); await evaluate('document.activeElement.blur()'); await press('8');
  await until("document.querySelectorAll('.screener-copy').length >= 2");
  for (const index of [1, 2]) {
    await focus(`.screener-row:nth-of-type(${index}) .screener-copy`);
    const subject = await evaluate("document.activeElement.querySelector('b').textContent");
    await enter(); await until(`document.querySelector('.thread-panel h1')?.textContent === ${JSON.stringify(subject)}`);
    await back(); await until("document.activeElement.matches('.screener-copy')");
  }

  await fresh();
  for (const index of [1, 2]) {
    await click('.session-history-link');
    await until("document.querySelectorAll('.session-history-title').length >= 2");
    await focus(`.session-history-table tbody tr:nth-child(${index}) .session-history-title`);
    const title = await evaluate('document.activeElement.textContent');
    await enter(); await until(`document.querySelector('.agent-tab[aria-selected=true]')?.textContent === ${JSON.stringify(title)}`);
  }
  await click('[aria-label^="Switch account"]');
  await until("document.activeElement.matches('.account-options button')");
  const account = await evaluate('document.activeElement.title');
  await press('ArrowDown');
  assert.notEqual(await evaluate('document.activeElement.title'), account);
  await press('Escape'); // No account switch requested.
  await click('[aria-label="Profile options"]');
  await enter(); await until("Boolean(document.querySelector('.settings-section-toggle'))");
  await focus('.settings-section-toggle'); await press('ArrowDown');
  const section = await evaluate('document.activeElement.id');
  await enter(); await until(`document.getElementById(${JSON.stringify(section)})?.getAttribute('aria-expanded') === 'true'`);

  // A slow response for the previous draft must not replace the newer choice.
  await fresh();
  await evaluate(`(() => {
    const drafts=['A','B'].map(id=>({id,subject:'Draft '+id,to:'test@example.com',cc:'',bcc:'',body:'Body '+id}));
    window.heyAgent.mail.listDrafts=async()=>drafts;
    window.resolveDraft={};
    window.heyAgent.mail.showDraft=id=>new Promise(resolve=>{window.resolveDraft[id]=()=>resolve(drafts.find(draft=>draft.id===id));});
  })()`);
  await evaluate("[...document.querySelectorAll('nav button')].find(button=>button.textContent==='Drafts').click()");
  await until("document.querySelectorAll('.draft-list button').length === 2");
  await click('.draft-list button:nth-child(1)'); await click('.draft-list button:nth-child(2)');
  await evaluate("window.resolveDraft.B()");
  await until("document.querySelector('.draft-editor textarea')?.value === 'Body B'");
  await evaluate("window.resolveDraft.A()"); await press('Shift');
  assert.equal(await evaluate("document.querySelector('.draft-editor textarea').value"), 'Body B');
  console.log('List navigation passed: mailbox focus/selection, command palette, bundle reopen/back controls, search, contact history, Calendar, Calendar search, Helper/account menus, recipients, Screener, agent tabs/history, Settings, and out-of-order draft loads. Synthetic data only.');
}
