import assert from "node:assert/strict";

// Real renderer actions with a disposable, synthetic HEY bridge.
export async function checkReadOnOpen({ evaluate, until, click, press }) {
  await evaluate(`(() => {
    const mail = window.heyAgent.mail;
    window.readProof = { calls: [], reads: [], seen: {}, fail: false };
    const list = mail.listMailbox;
    mail.listMailbox = async box => {
      const result = await list(box);
      const seed = result.postings.find(row => row.topicId && row.kind !== 'bundle');
      return { ...result, postings: Array.from({length: 4}, (_, i) => ({
        ...seed, id: box + '-read-' + i, topicId: box + '-topic-' + i,
        kind: undefined, bubbledUp: false, seen: Boolean(window.readProof.seen[box + '-read-' + i])
      })) };
    };
    mail.readThread = async id => {
      window.readProof.reads.push(id);
      return { topicId: id, subject: 'Synthetic read test', entries: [] };
    };
    mail.mutate = async request => {
      window.readProof.calls.push(request);
      if (window.readProof.fail) throw new Error('Synthetic seen failure');
      for (const id of request.postingIds) window.readProof.seen[id] = request.operation === 'seen';
      return { message: 'Marked seen' };
    };
  })()`);

  for (const [key, box, title] of [['2', 'feedbox', 'The Feed'], ['3', 'trailbox', 'Paper Trail'], ['1', 'imbox', 'Inbox'], ['4', 'laterbox', 'Reply Later'], ['5', 'asidebox', 'Set Aside'], ['6', 'bubblebox', 'Bubble Up']]) {
    await evaluate('document.activeElement.blur()');
    await press(key);
    await until(`document.querySelector('[data-posting-id="${box}-read-0"]') !== null`);
    const callsBefore = await evaluate('window.readProof.calls.length');
    // Selecting a list cursor is not reading mail.
    await press('j');
    assert.equal(await evaluate('window.readProof.calls.length'), callsBefore, title + ': navigation must not mark seen');
    await click(`[data-posting-id="${box}-read-0"]`);
    // Inbox moves the opened row into Previously Seen, changing its neighbor.
    await until(`window.readProof.reads.includes('${box}-topic-0') && window.readProof.reads.some(id => id.startsWith('${box}-topic-') && id !== '${box}-topic-0')`);
    assert.deepEqual(await evaluate('window.readProof.calls.slice(' + callsBefore + ')'), [{operation: 'seen', postingIds: [box + '-read-0']}], title + ': neighbor prefetch must not mark seen');
    await press('Escape');
    await until("document.querySelector('.imbox-panel')?.hidden === false");
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-posting-id="${box}-read-0"] .unseen-dot'))`), false);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-posting-id="${box}-read-1"] .unseen-dot'))`), true);
    await click(`[data-posting-id="${box}-read-0"]`);
    await press('Escape');
    assert.equal(await evaluate('window.readProof.calls.length'), callsBefore + 1, title + ': reopening seen mail is not another write');

    for (const index of [1, 2]) await click(`[data-posting-id="${box}-read-${index}"] [data-bulk-toggle]`);
    await click('[data-tooltip="Read Together"]');
    await until(`window.readProof.calls.length === ${callsBefore + 2}`);
    assert.deepEqual(await evaluate('window.readProof.calls.at(-1)'), {operation: 'seen', postingIds: [box + '-read-1', box + '-read-2']});
    await press('Escape');
    await until("document.querySelector('.imbox-panel')?.hidden === false");
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-posting-id="${box}-read-2"] .unseen-dot'))`), false);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-posting-id="${box}-read-3"] .unseen-dot'))`), true);
  }
  await evaluate('window.readProof.fail = true');
  await click('[data-posting-id="bubblebox-read-3"]');
  await until("document.body.textContent.includes('Synthetic seen failure')");
  await press('Escape');
  await until("document.querySelector('.imbox-panel')?.hidden === false");
  assert.equal(await evaluate("Boolean(document.querySelector('[data-posting-id=\"bubblebox-read-3\"] .unseen-dot'))"), true, 'failed write restores unread state');
  console.log('Read-on-open passed: all six mailboxes, Read Together, cached reopen, untouched neighbors, read-only prefetch, and failure recovery. Synthetic data only.');
}
