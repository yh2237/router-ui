(() => {
  let activeTerminal = null;

  document.addEventListener("htmx:afterSettle", initializeTerminal);
  document.addEventListener("DOMContentLoaded", initializeTerminal);
  document.addEventListener("router-ui:navigate", cleanupTerminal);

  function initializeTerminal() {
    const terminal = document.querySelector("[data-terminal]");
    if (!(terminal instanceof HTMLElement) || terminal === activeTerminal) return;
    cleanupTerminal();
    activeTerminal = terminal;

    const output = terminal.querySelector("#terminal-output");
    const input = terminal.querySelector("#terminal-input");
    const connId = terminal.dataset.connId;
    if (!(output instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !connId) return;

    const history = [];
    let historyIndex = -1;

    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter" && input.value.trim() && !input.disabled) {
        const command = input.value;
        history.push(command);
        historyIndex = history.length;
        appendLine(output, `> ${command}`, "prompt");
        input.value = "";
        input.disabled = true;
        const pending = appendLine(output, "[実行中…]", "system");

        try {
          const response = await fetch(`/api/device/${encodeURIComponent(connId)}/terminal/execute`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "X-CSRF-Token": csrfToken(),
            },
            body: new URLSearchParams({ cmd: command }),
          });
          const text = await response.text();
          pending.remove();
          appendLine(output, text, response.ok ? "output" : "system");
        } catch (error) {
          pending.remove();
          appendLine(output, `Error: ${error instanceof Error ? error.message : "通信に失敗しました"}`, "system");
        } finally {
          input.disabled = false;
          input.focus();
        }
      } else if (event.key === "ArrowUp" && history.length) {
        event.preventDefault();
        historyIndex = Math.max(0, historyIndex - 1);
        input.value = history[historyIndex];
      } else if (event.key === "ArrowDown" && history.length) {
        event.preventDefault();
        historyIndex = Math.min(history.length, historyIndex + 1);
        input.value = historyIndex === history.length ? "" : history[historyIndex];
      }
    });

    appendLine(output, "[接続済み]", "system");
    input.disabled = false;
    input.focus();
  }

  function appendLine(output, text, className) {
    const line = document.createElement("div");
    line.className = `terminal-line ${className}`;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
    return line;
  }

  function cleanupTerminal() {
    activeTerminal = null;
  }

  function csrfToken() {
    return document.querySelector('meta[name="router-ui-csrf"]')?.getAttribute("content") || "";
  }
})();
