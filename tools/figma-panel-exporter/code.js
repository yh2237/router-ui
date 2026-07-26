figma.showUI(__html__, { width: 420, height: 520, themeColors: true });

const PANEL_STATES = ["up", "down", "warning", "error"];

figma.ui.onmessage = async (message) => {
  if (message.type === "cancel") {
    figma.closePlugin();
    return;
  }
  if (message.type !== "export") return;

  try {
    const selection = figma.currentPage.selection;
    if (selection.length !== 1 || selection[0].type !== "FRAME") {
      throw new Error("完成パネルのFrameを1つだけ選択してください。");
    }

    const sourceScale = Number(message.sourceScale);
    if (!Number.isFinite(sourceScale) || sourceScale <= 0) {
      throw new Error("制作倍率には0より大きい数値を指定してください。");
    }

    const root = selection[0];
    const rootBounds = root.absoluteBoundingBox;
    if (!rootBounds) throw new Error("完成パネルの座標を取得できません。");

    const instances = [];
    const labels = [];
    const partSources = new Map();
    const warnings = [];

    const descendants = root.findAll();
    for (const node of descendants) {
      if (node.type === "INSTANCE") {
        const main = typeof node.getMainComponentAsync === "function"
          ? await node.getMainComponentAsync()
          : node.mainComponent;
        if (!main) {
          warnings.push(`${relativePath(root, node)}: Main Componentを取得できません`);
          continue;
        }

        const set = main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : null;
        const componentName = set ? set.name : main.name;
        const kind = inferKind(root, node);
        const bounds = node.absoluteBoundingBox;
        if (!bounds) {
          warnings.push(`${relativePath(root, node)}: 座標を取得できません`);
          continue;
        }

        instances.push({
          path: relativePath(root, node),
          name: node.name,
          component: componentName,
          variant: { state: variantState(main) },
          kind,
          x: round(bounds.x - rootBounds.x),
          y: round(bounds.y - rootBounds.y),
          width: round(bounds.width),
          height: round(bounds.height),
          rotation: normalizeRotation(node.rotation)
        });

        if (!partSources.has(componentName)) {
          partSources.set(componentName, set || main);
        }
      }

      if (node.type === "TEXT" && hasAncestorNamed(root, node, "Label")) {
        const bounds = node.absoluteBoundingBox;
        if (!bounds) continue;
        const font = node.fontName !== figma.mixed ? node.fontName : null;
        labels.push({
          path: relativePath(root, node),
          name: node.name,
          text: node.characters,
          x: round(bounds.x - rootBounds.x),
          y: round(bounds.y - rootBounds.y),
          width: round(bounds.width),
          height: round(bounds.height),
          fontSize: node.fontSize !== figma.mixed ? Number(node.fontSize) : null,
          fontFamily: font ? font.family : null,
          fontStyle: font ? font.style : null,
          color: solidTextColor(node)
        });
      }
    }

    const parts = [];
    for (const [name, source] of partSources) {
      const variants = [];
      const components = source.type === "COMPONENT_SET"
        ? source.children.filter((child) => child.type === "COMPONENT")
        : [source];
      if (source.type === "COMPONENT_SET") validateVariantStates(name, components);

      for (const component of components) {
        const state = source.type === "COMPONENT_SET" ? variantState(component) : "base";
        const bytes = await component.exportAsync({
          format: "PNG",
          constraint: { type: "SCALE", value: 1 },
          useAbsoluteBounds: true
        });
        variants.push({
          state,
          width: round(component.width),
          height: round(component.height),
          data: uint8ToBase64(bytes)
        });
      }

      const first = components[0];
      parts.push({
        name,
        kind: inferPartKind(instances, name),
        width: round(first.width),
        height: round(first.height),
        variants
      });
    }

    const payload = {
      formatVersion: 1,
      source: {
        fileKey: figma.fileKey || null,
        pageId: figma.currentPage.id,
        pageName: figma.currentPage.name,
        panelNodeId: root.id,
        exportedAt: new Date().toISOString()
      },
      panel: {
        name: root.name,
        width: round(root.width),
        height: round(root.height),
        sourceScale
      },
      parts,
      instances,
      labels,
      warnings
    };

    figma.ui.postMessage({ type: "result", payload });
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

function relativePath(root, node) {
  const names = [node.name];
  let parent = node.parent;
  while (parent && parent.id !== root.id) {
    if (parent.type !== "PAGE") names.push(parent.name);
    parent = parent.parent;
  }
  return names.reverse().join("/");
}

function hasAncestorNamed(root, node, name) {
  let parent = node.parent;
  while (parent && parent.id !== root.id) {
    if (parent.name === name) return true;
    parent = parent.parent;
  }
  return false;
}

function inferKind(root, node) {
  if (hasAncestorNamed(root, node, "Lamp")) return "led";
  if (hasAncestorNamed(root, node, "Port")) return "port";
  return node.name.endsWith("_Base") ? "background" : "other";
}

function inferPartKind(instances, componentName) {
  const match = instances.find((instance) => instance.component === componentName);
  return match ? match.kind : "other";
}

function variantState(component) {
  if (component.variantProperties && component.variantProperties.state) {
    return String(component.variantProperties.state).toLowerCase();
  }
  const match = component.name.match(/(?:^|,)\s*state=([^,]+)/i);
  return match ? match[1].trim().toLowerCase() : "base";
}

function validateVariantStates(componentName, components) {
  const states = components.map((component) => variantState(component));
  const invalid = states.filter((state) => !PANEL_STATES.includes(state));
  if (invalid.length > 0) {
    throw new Error(
      `${componentName}: stateはup/down/warning/errorのみ使用できます（不正: ${invalid.join(", ")}）`
    );
  }
  const missing = PANEL_STATES.filter((state) => !states.includes(state));
  if (missing.length > 0) {
    throw new Error(`${componentName}: state Variantが不足しています（${missing.join(", ")}）`);
  }
  if (new Set(states).size !== states.length) {
    throw new Error(`${componentName}: 同じstateのVariantが重複しています`);
  }
}

function solidTextColor(node) {
  if (!Array.isArray(node.fills)) return null;
  const fill = node.fills.find((item) => item.type === "SOLID" && item.visible !== false);
  if (!fill) return null;
  const { r, g, b } = fill.color;
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function channel(value) {
  return Math.round(value * 255).toString(16).padStart(2, "0");
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function normalizeRotation(value) {
  const normalized = ((Number(value) % 360) + 360) % 360;
  if (Math.abs(normalized) < 0.001 || Math.abs(normalized - 360) < 0.001) return 0;
  if (Math.abs(normalized - 180) < 0.001) return 180;
  return round(normalized);
}

function uint8ToBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    output += alphabet[a >> 2];
    output += alphabet[((a & 3) << 4) | (b >> 4)];
    output += index + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=";
    output += index + 2 < bytes.length ? alphabet[c & 63] : "=";
  }
  return output;
}
