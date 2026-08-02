(() => {
  document.addEventListener("DOMContentLoaded", initializeConnectScreen);
  document.addEventListener("htmx:configRequest", (event) => {
    event.detail.headers["X-CSRF-Token"] = csrfToken();
  });
  function initializeConnectScreen() {
    const trigger = document.getElementById("model-trigger");
    const dropdown = document.getElementById("model-dropdown");
    const search = document.getElementById("model-search");
    const options = document.getElementById("model-options");
    const valueInput = document.getElementById("model-value");
    const display = document.getElementById("model-display");
    const placeholder = document.getElementById("model-placeholder");
    const modelSelect = document.getElementById("model-select");
    if (!trigger || !dropdown || !(search instanceof HTMLInputElement) || !options
      || !(valueInput instanceof HTMLInputElement) || !display || !placeholder || !modelSelect) return;

    const optionElements = () => Array.from(options.querySelectorAll(".model-option"))
      .filter((option) => option instanceof HTMLElement && !option.hidden);

    function filterOptions(query) {
      const normalized = query.toLocaleLowerCase("ja");
      for (const item of options.querySelectorAll(".model-option")) {
        if (!(item instanceof HTMLElement)) continue;
        item.hidden = !item.textContent.toLocaleLowerCase("ja").includes(normalized);
        item.tabIndex = -1;
      }
    }

    function selectOption(option, applyDefaults = true) {
      if (!(option instanceof HTMLElement)) return;
      valueInput.value = option.dataset.value || "";
      display.textContent = option.textContent;
      placeholder.classList.add("hidden");
      for (const item of options.querySelectorAll('[role="option"]')) {
        item.setAttribute("aria-selected", item === option ? "true" : "false");
      }
      if (applyDefaults) applyTransportDefaults(option.dataset.transport);
      closeDropdown(true);
    }

    function applyTransportDefaults(transport) {
      const radio = document.querySelector(`input[name="transport"][value="${transport}"]`);
      const port = document.getElementById("port");
      if (!(radio instanceof HTMLInputElement) || !(port instanceof HTMLInputElement)) return;
      radio.checked = true;
      port.value = transport === "telnet" ? "23" : "22";
      synchronizeAuthentication(transport);
    }

    function synchronizeAuthentication(transport) {
      const passwordRadio = document.querySelector('input[name="auth_method"][value="password"]');
      const keyRadio = document.querySelector('input[name="auth_method"][value="key"]');
      if (!(passwordRadio instanceof HTMLInputElement) || !(keyRadio instanceof HTMLInputElement)) return;
      const isTelnet = transport === "telnet";
      keyRadio.disabled = isTelnet;
      if (isTelnet) passwordRadio.checked = true;
      updateAuthFields();
    }

    function updateAuthFields() {
      const keyRadio = document.querySelector('input[name="auth_method"][value="key"]');
      const usingKey = keyRadio instanceof HTMLInputElement && keyRadio.checked && !keyRadio.disabled;
      const passwordField = document.getElementById("password-field");
      const keyField = document.getElementById("private-key-field");
      const password = document.getElementById("password");
      const privateKey = document.getElementById("private-key");
      if (passwordField) passwordField.hidden = usingKey;
      if (keyField) keyField.hidden = !usingKey;
      if (password instanceof HTMLInputElement) password.required = !usingKey;
      if (privateKey instanceof HTMLTextAreaElement) privateKey.required = usingKey;
    }

    function closeDropdown(restoreFocus = false) {
      dropdown.classList.remove("open");
      trigger.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus) trigger.focus();
    }

    function openDropdown(focusOptions = false) {
      dropdown.classList.add("open");
      trigger.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
      search.value = "";
      filterOptions("");
      if (focusOptions) focusOption(0);
      else search.focus();
    }

    function focusOption(index) {
      const visible = optionElements();
      if (visible.length === 0) return;
      const next = visible[(index + visible.length) % visible.length];
      next.tabIndex = 0;
      next.focus();
    }

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (dropdown.classList.contains("open")) closeDropdown();
      else openDropdown();
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (dropdown.classList.contains("open")) closeDropdown();
        else openDropdown();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openDropdown(true);
        if (event.key === "ArrowUp") focusOption(optionElements().length - 1);
      } else if (event.key === "Escape") {
        closeDropdown();
      }
    });

    search.addEventListener("input", () => filterOptions(search.value));
    search.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusOption(0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusOption(optionElements().length - 1);
      } else if (event.key === "Enter") {
        const visible = optionElements();
        if (visible.length === 1) {
          event.preventDefault();
          selectOption(visible[0]);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeDropdown(true);
      }
    });

    options.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      selectOption(target.closest(".model-option"));
    });
    options.addEventListener("keydown", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(".model-option")) return;
      const visible = optionElements();
      const current = visible.indexOf(target);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusOption(current + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusOption(current - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusOption(visible.length - 1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectOption(target);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeDropdown(true);
      }
    });

    document.addEventListener("click", (event) => {
      if (!modelSelect.contains(event.target)) closeDropdown();
      const target = event.target;
      if (!(target instanceof Element)) return;
      const saved = target.closest("[data-saved-model]");
      if (!(saved instanceof HTMLButtonElement)) return;
      setInputValue("host", saved.dataset.savedHost);
      setInputValue("port", saved.dataset.savedPort);
      setInputValue("username", saved.dataset.savedUsername);
      setModel(saved.dataset.savedModel, false);
      applyTransportDefaults(saved.dataset.savedTransport);
    });

    function setModel(modelName, applyDefaults = true) {
      const option = Array.from(options.querySelectorAll(".model-option"))
        .find((item) => item instanceof HTMLElement && item.dataset.value === modelName);
      if (option) selectOption(option, applyDefaults);
    }

    for (const radio of document.querySelectorAll('input[name="auth_method"]')) {
      radio.addEventListener("change", updateAuthFields);
    }
    for (const radio of document.querySelectorAll('input[name="transport"]')) {
      radio.addEventListener("change", () => {
        if (!(radio instanceof HTMLInputElement) || !radio.checked) return;
        const port = document.getElementById("port");
        if (port instanceof HTMLInputElement) port.value = radio.value === "telnet" ? "23" : "22";
        synchronizeAuthentication(radio.value);
      });
    }
    const selectedTransport = document.querySelector('input[name="transport"]:checked');
    if (selectedTransport instanceof HTMLInputElement) synchronizeAuthentication(selectedTransport.value);
  }

  function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input instanceof HTMLInputElement) input.value = value || "";
  }

  function csrfToken() {
    return document.querySelector('meta[name="router-ui-csrf"]')?.getAttribute("content") || "";
  }
})();
