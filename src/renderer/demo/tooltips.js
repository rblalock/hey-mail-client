// Native titles can reveal the original subject/address on hover. App-owned
// data-tooltip controls stay available. This changes no persisted data.
function removeTitles(root) {
  if (!(root instanceof Element)) return;
  root.removeAttribute("title");
  root.querySelectorAll("[title]").forEach((element) => element.removeAttribute("title"));
}

removeTitles(document.documentElement);
const observer = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === "attributes") record.target.removeAttribute("title");
    else record.addedNodes.forEach(removeTitles);
  }
});
observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
import.meta.hot?.dispose(() => observer.disconnect());
