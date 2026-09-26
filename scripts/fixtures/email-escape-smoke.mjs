import assert from "node:assert/strict";

export async function checkEmailEscape({ evaluate, until, click, fill, press }) {
  await evaluate(`(() => {
    window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
    window.cancelAnimationFrame = clearTimeout;
    const read = window.heyAgent.mail.readThread;
    window.heyAgent.mail.readThread = async id => {
      const thread = await read(id);
      return { ...thread, entries: thread.entries.map(entry => ({ ...entry,
        html: '<p id="body-copy">Synthetic email body</p><a href="https://example.com">Example link</a>',
        remoteHtml: '<p id="body-copy">Synthetic expanded email</p><a href="https://example.com">Example link</a>',
        hasRemoteContent: true
      })) };
    };
  })()`);
  const frameReady = async () => until("Boolean(document.querySelector('.email-document-frame')?.contentDocument?.querySelector('#body-copy'))");
  const escapeFrame = async (target = 'body', options = {}) => {
    await frameReady();
    return evaluate(`(() => {
      const frame = document.querySelector('.email-document-frame');
      const target = frame.contentDocument.querySelector(${JSON.stringify(target)});
      target.tabIndex = -1; target.focus();
      const event = new frame.contentWindow.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true, ...${JSON.stringify(options)}});
      return !target.dispatchEvent(event);
    })()`);
  };
  const checkReturn = async (selector, id) => {
    await until("!document.querySelector('.thread-panel')");
    await until(`document.activeElement.matches(${JSON.stringify(selector)}) && document.activeElement.dataset.postingId === ${JSON.stringify(id)}`);
  };

  for (const key of ['1', '2', '3', '4', '5', '6']) {
    await evaluate('document.activeElement.blur()'); await press(key);
    await until("Boolean(document.querySelector('.mail-row'))");
    const id = await evaluate("document.querySelector('.mail-row').dataset.postingId");
    await click('.mail-row'); await frameReady();
    assert.equal(await evaluate("document.querySelector('.email-document-frame').sandbox.contains('allow-scripts')"), false);
    for (const options of [{repeat:true}, {isComposing:true}, {keyCode:229}, {ctrlKey:true}, {altKey:true}, {metaKey:true}, {shiftKey:true}]) {
      assert.equal(await escapeFrame('body', options), false);
      assert.equal(await evaluate("Boolean(document.querySelector('.thread-panel'))"), true);
    }
    // A frame-local preview consumes Escape before the app sees it.
    await evaluate("document.querySelector('.email-document-frame').contentDocument.addEventListener('keydown', event => { event.preventDefault(); event.stopImmediatePropagation(); }, {capture:true, once:true})");
    await escapeFrame();
    assert.equal(await evaluate("Boolean(document.querySelector('.thread-panel'))"), true);
    await click('.email-remote-control'); await frameReady();
    await escapeFrame('a');
    await checkReturn('.mail-row', id);
    // Escape restores native button focus. Moving the list cursor must move that
    // focus too, or native Enter activates the old row despite the new highlight.
    for (const key of ['j', 'k', 'ArrowDown', 'ArrowUp']) {
      const before = await evaluate("document.querySelector('.mail-row[data-selected=true]').dataset.postingId");
      await press(key);
      const next = await evaluate("document.querySelector('.mail-row[data-selected=true]').dataset.postingId");
      assert.notEqual(next, before, `List cursor should move with ${key}`);
      assert.equal(await evaluate("document.activeElement.dataset.postingId"), next, `Native focus should follow ${key}`);
      const subject = await evaluate("document.activeElement.querySelector('.subject-line strong').textContent");
      // DOM-dispatched key events lack browser defaults in this hidden harness.
      await evaluate('document.activeElement.click()');
      await until(`document.querySelector('.thread-panel h1')?.textContent === ${JSON.stringify(subject)}`);
      await evaluate("(() => { const panel=document.querySelector('.thread-panel'); panel.tabIndex=-1; panel.focus(); })()");
      await press('Escape'); await checkReturn('.mail-row', next);
    }
  }

  await evaluate('document.activeElement.blur()'); await press('2');
  const togetherId = await evaluate("document.querySelector('.mail-row').dataset.postingId");
  await click('.mail-row [data-bulk-toggle]');
  await evaluate("document.querySelectorAll('.mail-row')[1].querySelector('[data-bulk-toggle]').click()");
  await click('[data-tooltip="Read Together"]');
  await escapeFrame(); await checkReturn('.mail-row', togetherId);
  await press('Escape'); // clear bulk selection

  await evaluate('document.activeElement.blur()'); await press('/');
  await until("Boolean(document.querySelector('[aria-label=\"Search all email\"]'))");
  await fill('[aria-label="Search all email"]', 'launch'); await press('Enter');
  await until("Boolean(document.querySelector('.mail-search-results [data-posting-id]'))");
  const searchId = await evaluate("document.querySelector('.mail-search-results [data-posting-id]').dataset.postingId");
  await click('.mail-search-results [data-posting-id]');
  await escapeFrame(); await checkReturn('.mail-search-results button', searchId);
  await press('Escape');

  await evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Library').click()");
  await until("Boolean(document.querySelector('.library-contact-row'))");
  await click('.library-contact-row');
  await until("Boolean(document.querySelector('.library-conversations [data-posting-id]'))");
  const contactId = await evaluate("document.querySelector('.library-conversations [data-posting-id]').dataset.postingId");
  await click('.library-conversations [data-posting-id]');
  await escapeFrame(); await checkReturn('.library-conversations button', contactId);

  // Bundle listings remount when their individual reader closes.
  await evaluate(`(() => {
    const list = window.heyAgent.mail.listMailbox;
    window.heyAgent.mail.listMailbox = async box => {
      const result = await list(box);
      return {...result, postings: result.postings.map((row, i) => i === 0 ? {...row, kind:'bundle'} : row)};
    };
  })()`);
  await evaluate('document.activeElement.blur()'); await press('2');
  await click('.imbox-titlebar [aria-label^="Refresh"]');
  await until("!document.querySelector('.imbox-titlebar [aria-label^=\"Refresh\"]').disabled");
  await click('.mail-row');
  await until("Boolean(document.querySelector('.thread-listing-row'))");
  const bundleId = await evaluate("document.querySelector('.thread-listing-row').dataset.postingId");
  await click('.thread-listing-row');
  await escapeFrame(); await checkReturn('.thread-listing-row', bundleId);
  await evaluate('document.activeElement.blur()'); await press('8');
  await until("Boolean(document.querySelector('.screener-copy'))");
  const screenerId = await evaluate("document.querySelector('.screener-copy').dataset.screenerId");
  await click('.screener-copy'); await escapeFrame();
  await until(`document.activeElement.classList.contains('screener-copy') && document.activeElement.dataset.screenerId === ${JSON.stringify(screenerId)}`);
  console.log('Email Escape passed: all mailboxes, body/link focus, iframe reload, modifier/IME/repeat guards, consumed preview Escape, Read Together, search, contact history, bundle, Screener, and source-row focus. Synthetic data only.');
}
