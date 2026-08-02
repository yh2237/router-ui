(() => {
  const rules = [
    ["time", "timezoneMode", ["custom"], ["timezoneOffset"]],
    ["time", "ntpSourceMode", ["set"], ["ntpSourceAddress"]],
    ["interfaces", "action", ["static", "static-v6"], ["address"]],
    ["lan-mode", "action", ["set"], ["speed", "port", "mtu", "separation"]],
    ["nat", "action", ["configure"], ["type", "outer", "inner", "attachInterface"]],
    ["provider", "action", ["configure"], ["interface", "username", "password", "mru", "natDescriptor", "alwaysOn"]],
    ["vpn", "action", ["configure"], ["policy", "gatewayId", "remote", "preSharedKey", "encryption", "authentication"]],
    ["dns", "serverAction", ["set"], ["servers"]],
    ["logging", "hostAction", ["set"], ["hosts"]],
    ["logging", "localAddressAction", ["set"], ["localAddress"]],
    ["snmp", "accessAction", ["set"], ["accessHost", "readCommunity"]],
    ["snmp", "trapAction", ["set"], ["trapHost", "trapCommunity"]],
    ["snmp", "sysNameAction", ["set"], ["sysName"]],
    ["snmp", "sysLocationAction", ["set"], ["sysLocation"]],
    ["snmp", "sysContactAction", ["set"], ["sysContact"]],
    ["upnp", "externalType", ["pp"], ["peer"]],
    ["upnp", "timerAction", ["set"], ["timer"]],
  ];

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const form = target.closest(".settings-form");
    if (form instanceof HTMLFormElement) updateDependencies(form);
  });

  document.addEventListener("htmx:afterSwap", (event) => {
    const target = event.target;
    if (target instanceof Element) initializeForms(target);
  });

  document.addEventListener("DOMContentLoaded", () => initializeForms(document));

  function initializeForms(root) {
    for (const form of root.querySelectorAll(".settings-form")) {
      if (form instanceof HTMLFormElement) updateDependencies(form);
    }
  }

  function updateDependencies(form) {
    const section = form.dataset.settingsSection;
    for (const [ruleSection, controller, activeValues, targets] of rules) {
      if (section !== ruleSection) continue;
      if (!hasNamedControl(form, controller)) continue;
      const value = controlValue(form, controller);
      const visible = activeValues.includes(value);
      for (const target of targets) setFieldVisible(form, target, visible);
    }

    if (section === "dhcp" && hasNamedControl(form, "scopeAction")) {
      const action = controlValue(form, "scopeAction");
      setFieldVisible(form, "scope", action === "set" || action === "remove");
      for (const name of ["startAddress", "endAddress", "prefix", "gateway", "expire"]) {
        setFieldVisible(form, name, action === "set");
      }
    }

    if (section === "time" && hasNamedControl(form, "syncNtp")) {
      const sync = controlChecked(form, "syncNtp");
      setFieldVisible(form, "ntpServer", sync);
      setFieldVisible(form, "ntpSyslog", sync);
    }

    if (section === "routing" && hasNamedControl(form, "gatewayType")) {
      const adding = !hasNamedControl(form, "action") || controlValue(form, "action") === "add";
      const type = controlValue(form, "gatewayType");
      setFieldVisible(form, "gatewayType", adding);
      setFieldVisible(form, "gateway", adding && type === "address");
      setFieldVisible(form, "gatewayInterface", adding && type === "dhcp");
      setFieldVisible(form, "gatewayNumber", adding && (type === "pp" || type === "tunnel"));
      setFieldVisible(form, "metric", adding);
      setFieldVisible(form, "hide", adding);
    }
  }

  function controlsNamed(form, name) {
    return [...form.querySelectorAll("[name]")].filter((control) => control.getAttribute("name") === name);
  }

  function hasNamedControl(form, name) {
    return controlsNamed(form, name).length > 0;
  }

  function controlValue(form, name) {
    const controls = controlsNamed(form, name);
    const checked = controls.find((control) => control instanceof HTMLInputElement && control.checked);
    const control = checked ?? controls[0];
    return control instanceof HTMLInputElement || control instanceof HTMLSelectElement ? control.value : "";
  }

  function controlChecked(form, name) {
    return controlsNamed(form, name).some((control) => control instanceof HTMLInputElement && control.checked);
  }

  function setFieldVisible(form, name, visible) {
    const controls = controlsNamed(form, name);
    const field = controls[0]?.closest(".form-field");
    if (!(field instanceof HTMLElement)) return;
    field.hidden = !visible;
    field.setAttribute("aria-hidden", visible ? "false" : "true");
    for (const control of controls) {
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
        control.disabled = !visible;
      }
    }
  }
})();
