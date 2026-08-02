(() => {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tab = target.closest("[data-main-tab]");
    if (!(tab instanceof HTMLButtonElement)) return;

    document.dispatchEvent(new CustomEvent("router-ui:navigate"));
    const workbench = document.querySelector(".app-workbench");
    const secondary = document.getElementById("settings-secondary-sidebar");
    const settingsOpen = tab.dataset.mainTab === "settings";
    workbench?.classList.toggle("settings-open", settingsOpen);
    if (secondary) secondary.hidden = !settingsOpen;
    for (const item of document.querySelectorAll("[data-main-tab]")) {
      item.classList.toggle("active", item === tab);
      item.setAttribute("aria-current", item === tab ? "page" : "false");
    }
  }, { capture: true });
})();
