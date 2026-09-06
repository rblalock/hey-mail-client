import assert from "node:assert/strict";

// Uses only the disposable preview bridge. No HEY or model calls.
export async function checkDraftReview({ evaluate, until, click, fill, press }) {
  const review = 'dialog.draft-review-dialog[open]';
  const body = '[placeholder="Write your message…"]';
  const editor = '[aria-label="Suggested email draft"]';
  const tab = async (name) => evaluate(`[...document.querySelectorAll('${review} [role=tab]')].find(n=>n.textContent===${JSON.stringify(name)}).click()`);
  const original = "Synthetic draft only.";
  const generate = async () => {
    await click(body); await press("k", ["control"]);
    await until("Boolean(document.querySelector('.composer-writing-popover'))");
    await fill('.composer-writing-popover input', 'Make it clearer'); await press("Enter", ["control"]);
    await until(`Boolean(document.querySelector('${review}'))`);
  };
  await until(`Boolean(document.querySelector('${review}'))`);
  assert.equal(await evaluate(`document.querySelector('${body}').value`), original);
  assert.equal(await evaluate(`document.querySelector('${review} [role=tab][aria-selected=true]').textContent`), "Changes");
  await evaluate(`document.querySelector('${review} .draft-review-heading button').focus()`);
  await press("Tab", ["shift"]);
  assert.equal(await evaluate(`document.activeElement===document.querySelector('${review} .primary-button')`), true);
  await press("Tab");
  assert.equal(await evaluate(`document.activeElement===document.querySelector('${review} .draft-review-heading button')`), true);
  await until(`Boolean(document.querySelector('${review} diffs-container')?.shadowRoot?.querySelector('[data-line]'))`);
  await tab("Draft");
  await fill(editor, "Reviewed and edited draft.");
  await tab("Changes"); await tab("Draft");
  assert.equal(await evaluate(`document.querySelector('${editor}').value`), "Reviewed and edited draft.");
  assert.equal(await evaluate(`document.querySelector('${body}').value`), original);
  await click(editor);
  await evaluate(`for (const flags of [{repeat:true},{isComposing:true},{keyCode:229},{shiftKey:true},{altKey:true}]) document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true,...flags})); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true}));`);
  assert.equal(await evaluate(`Boolean(document.querySelector('${review}'))`), true);
  assert.equal(await evaluate("window.proof.sends.length"), 0);
  await press("Escape");
  await until(`!document.querySelector('${review}')`);
  assert.equal(await evaluate(`document.querySelector('${body}').value`), original);
  await until(`document.activeElement===document.querySelector('${body}')`);

  await generate(); await tab("Draft"); await fill(editor, "Reviewed and edited draft.");
  await press("Enter", ["control"]);
  await until(`!document.querySelector('${review}')`);
  assert.equal(await evaluate(`document.querySelector('${body}').value`), "Reviewed and edited draft.");
  assert.equal(await evaluate("window.proof.sends.length"), 0);
  await click('.composer-writing-restore');
  assert.equal(await evaluate(`document.querySelector('${body}').value`), original);

  await generate();
  // Simulate a late update without attempting to focus the inert composer.
  await evaluate(`(() => { const node=document.querySelector('${body}'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,'Newer text stays safe.'); node.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await until(`document.querySelector('${review} [role=alert]')?.textContent.includes('Your draft changed')`);
  assert.equal(await evaluate(`document.querySelector('${review} .primary-button').disabled`), true);
  await press("Enter", ["control"]); await press("Escape");
  assert.equal(await evaluate(`document.querySelector('${body}').value`), "Newer text stays safe.");

  await fill(body, ""); await generate();
  assert.equal(await evaluate(`document.querySelector('${review} [role=tab][aria-selected=true]').textContent`), "Draft");
  await fill(editor, "   ");
  assert.equal(await evaluate(`document.querySelector('${review} .primary-button').disabled`), true);
  await press("Escape"); await fill(body, original);
  assert.equal(await evaluate("window.proof.sends.length"), 0);
  console.log("Draft review smoke passed: lazy Pierre comparison, editable proposal retained across tabs, discard, explicit apply, Restore, stale draft guard, blank proposal guard, new-draft default, IME/repeat protection, and zero mail sends.");
}
