(() => {
  let activeRequest = null;

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest("[data-settings-url]");
    if (!(button instanceof HTMLButtonElement)) return;

    const url = button.dataset.settingsUrl;
    if (!url) return;

    event.preventDefault();
    const content = ensureSettingsContent();
    if (!content) return;
    activeRequest?.abort();

    const controller = new AbortController();
    activeRequest = controller;
    setActiveItem(button);
    content.setAttribute("aria-busy", "true");

    try {
      const response = await fetch(url, {
        headers: {
          "HX-Request": "true",
          "HX-Target": "settings-content",
        },
        signal: controller.signal,
      });
      const html = await response.text();
      if (!response.ok) {
        throw new Error(html || `HTTP ${response.status}`);
      }

      content.innerHTML = html;
      window.htmx?.process(content);
      content.focus({ preventScroll: true });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      content.innerHTML = `
        <div class="settings-notice settings-notice--error">
          <strong>設定画面を読み込めませんでした。</strong>
          <p>接続状態を確認して、もう一度選択してください。</p>
        </div>
      `;
    } finally {
      if (activeRequest === controller) {
        activeRequest = null;
        content.removeAttribute("aria-busy");
      }
    }
  });

  function setActiveItem(selected) {
    const sidebar = selected.closest(".settings-secondary-sidebar");
    if (!sidebar) return;
    for (const item of sidebar.querySelectorAll("[data-settings-url]")) {
      item.classList.toggle("active", item === selected);
    }
  }

  function ensureSettingsContent() {
    const current = document.getElementById("settings-content");
    if (current) return current;

    const tabContent = document.getElementById("tab-content");
    if (!tabContent) return null;

    tabContent.innerHTML = `
      <div class="settings-page">
        <div class="settings-content" id="settings-content" tabindex="-1"></div>
      </div>
    `;
    return document.getElementById("settings-content");
  }
})();
