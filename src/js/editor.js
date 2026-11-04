export function placeCaretAtEnd(el) {
  el.focus();
  const selection = window.getSelection();
  if (selection.rangeCount && el.contains(selection.anchorNode)) return selection.getRangeAt(0);
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

export function insertTextAtCursor(el, text) {
  placeCaretAtEnd(el);
  document.execCommand("insertText", false, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function insertNodeAtCursor(el, node) {
  const selection = window.getSelection();
  const range = placeCaretAtEnd(el);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function serializeEditor(el) {
  let out = "";
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches("[data-emote-code]")) {
      out += node.dataset.emoteCode || "";
      return;
    }
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    if (node.tagName === "DIV" || node.tagName === "P") {
      if (out && !out.endsWith("\n")) out += "\n";
    }
    node.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function insertIntoTextarea(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
  el.focus();
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
