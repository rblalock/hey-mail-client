import assert from "node:assert/strict";

// Only the synthetic preview API is replaced. Never starts an external agent.
export async function checkAgentHandoff({ evaluate, until, click, fill, press }) {
  const dialog = '.agent-handoff-dialog[open]';
  await evaluate(`window.handoffProof={copies:[],launches:[]}; window.heyAgent.agent.copyHandoff=async r=>{window.handoffProof.copies.push(r)}; window.heyAgent.agent.launchHandoff=async r=>{window.handoffProof.launches.push(r);await new Promise(resolve=>setTimeout(resolve,100))}; true`);
  const open = async () => {
    await click('[aria-label="Session options"]');
    await evaluate(`[...document.querySelectorAll('.agent-session-action')].find(n=>n.textContent.includes('another agent')).click()`);
    await until(`Boolean(document.querySelector('${dialog} textarea')?.value)`);
  };
  await open();
  assert.equal(await evaluate("window.handoffProof.launches.length+window.handoffProof.copies.length"), 0);
  await fill(`${dialog} textarea`, "Reviewed handoff text. No live data.");
  await press("Enter", ["control"]);
  assert.equal(await evaluate("window.handoffProof.launches.length+window.handoffProof.copies.length"), 0, "Ctrl+Enter must not send or launch from the prompt editor");
  await click(`${dialog} .primary-button`);
  await until("window.handoffProof.copies.length===1");
  assert.equal(await evaluate("window.handoffProof.copies[0].prompt"), "Reviewed handoff text. No live data.");
  await evaluate(`(() => {const n=document.querySelector('${dialog} select');n.value='codex';n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('${dialog} .primary-button')?.textContent.includes('Open Codex')`);
  assert.equal(await evaluate(`document.querySelector('${dialog} textarea').value`), "Reviewed handoff text. No live data.");
  await evaluate(`document.querySelector('${dialog} .primary-button').click();document.querySelector('${dialog} .primary-button').click();`);
  await until(`document.querySelector('${dialog} [role=status]')?.textContent.includes('Terminal launch requested')`);
  assert.equal(await evaluate("window.handoffProof.launches.length"), 1);
  assert.equal(await evaluate(`document.querySelector('${dialog} .primary-button').disabled`), true);
  await press("Escape"); await until(`!document.querySelector('${dialog}')`);
  await open(); await fill(`${dialog} textarea`, "  ");
  assert.equal(await evaluate(`document.querySelector('${dialog} .primary-button').disabled`), true);
  await fill(`${dialog} textarea`, "Keep edits on failure.");
  await evaluate("window.heyAgent.agent.copyHandoff=async()=>{throw new Error('Synthetic clipboard failure. Try again.')}; true");
  await click(`${dialog} .primary-button`);
  await until(`document.querySelector('${dialog} [role=alert]')?.textContent.includes('Synthetic clipboard failure')`);
  assert.equal(await evaluate(`document.querySelector('${dialog} textarea').value`), "Keep edits on failure.");
  await press("Escape"); await until(`!document.querySelector('${dialog}')`);
  console.log("Handoff smoke passed: preview has no side effects, exact edited copy/launch payloads, destination preserves edits, Ctrl+Enter does not launch, single-launch guard, blank prompt, error retention, Escape. All destinations synthetic.");
}
