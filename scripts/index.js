import { GameMode, system, world } from "@minecraft/server";

import {
  CustomForm,
  DataDrivenScreenClosedReason,
  ObservableBoolean,
  ObservableNumber,
  ObservableString,
} from "@minecraft/server-ui";

import { transferPlayer } from "@minecraft/server-admin";

const SERVERS_KEY = "servers";
const MENU_RETRY_DELAY = 50;

/**
 * @typedef {Object} ServerEntry
 * @property {string} name
 * @property {string} ip
 * @property {number} port
 */

/**
 * @typedef {Object} ServerDraft
 * @property {string} name
 * @property {string} ip
 * @property {string} port
 */

/**
 * Reads and validates the saved server list.
 *
 * @returns {ServerEntry[]}
 */
function getServers() {
  const storedValue = world.getDynamicProperty(SERVERS_KEY);

  if (typeof storedValue !== "string") {
    return [];
  }

  try {
    const parsedValue = JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .map(normalizeServer)
      .filter((server) => server !== undefined);
  } catch (error) {
    console.warn("Failed to read saved servers:", error);
    return [];
  }
}

/**
 * Saves the server list.
 *
 * @param {ServerEntry[]} servers
 */
function saveServers(servers) {
  world.setDynamicProperty(SERVERS_KEY, JSON.stringify(servers));
}

/**
 * Validates and normalizes a stored server.
 *
 * @param {unknown} value
 * @returns {ServerEntry | undefined}
 */
function normalizeServer(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";

  const ip = typeof value.ip === "string" ? value.ip.trim() : "";

  const port = Number(value.port);

  if (!name || !ip || !isValidPort(port)) {
    return undefined;
  }

  return {
    name,
    ip,
    port,
  };
}

/**
 * Validates a Minecraft server port.
 *
 * @param {number} port
 */
function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Converts a saved server into an editable draft.
 *
 * @param {ServerEntry} server
 * @returns {ServerDraft}
 */
function createServerDraft(server) {
  return {
    name: server.name,
    ip: server.ip,
    port: String(server.port),
  };
}

/**
 * Converts and validates an editable server draft.
 *
 * @param {ServerDraft} draft
 * @returns {ServerEntry | undefined}
 */
function parseServerDraft(draft) {
  const name = draft.name.trim();
  const ip = draft.ip.trim();
  const port = Number(draft.port.trim());

  if (!name || !ip || !isValidPort(port)) {
    return undefined;
  }

  return {
    name,
    ip,
    port,
  };
}

/**
 * Validates an entire collection of server drafts.
 *
 * @param {ServerDraft[]} drafts
 * @returns {{
 *   servers?: ServerEntry[],
 *   errorIndex?: number
 * }}
 */
function validateServerDrafts(drafts) {
  /** @type {ServerEntry[]} */
  const servers = [];

  for (let index = 0; index < drafts.length; index++) {
    const server = parseServerDraft(drafts[index]);

    if (!server) {
      return {
        errorIndex: index,
      };
    }

    servers.push(server);
  }

  return {
    servers,
  };
}

/**
 * Formats a server for a menu button.
 *
 * @param {ServerEntry} server
 */
function formatServerButton(server) {
  return `${server.name}`;
}

/**
 * Formats an editable draft for a dropdown.
 *
 * @param {ServerDraft} draft
 */
function formatServerDropdownItem(draft) {
  const name = draft.name.trim() || "(Unnamed Server)";

  const ip = draft.ip.trim() || "(No Hostname)";

  const port = draft.port.trim() || "?";

  return `${name} — ${ip}:${port}`;
}

/**
 * Restricts an index to the available server range.
 *
 * @param {number} index
 * @param {number} length
 */
function clampIndex(index, length) {
  if (length <= 0) {
    return 0;
  }

  const normalizedIndex = Number.isFinite(index) ? Math.floor(index) : 0;

  return Math.max(0, Math.min(normalizedIndex, length - 1));
}

/**
 * Moves an array item to another position.
 *
 * @template T
 * @param {T[]} items
 * @param {number} fromIndex
 * @param {number} toIndex
 */
function moveItem(items, fromIndex, toIndex) {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return false;
  }

  const [item] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, item);

  return true;
}

/**
 * Places the player in spectator mode.
 *
 * @param {import("@minecraft/server").Player} player
 */
function setSelectorGameMode(player) {
  try {
    if (player.getGameMode() !== GameMode.Spectator) {
      player.setGameMode(GameMode.Spectator);
    }
  } catch (error) {
    console.warn(`Failed to set ${player.name} to spectator mode:`, error);
  }
}

/**
 * Schedules another menu to open.
 *
 * @param {import("@minecraft/server").Player} player
 * @param {(player: import("@minecraft/server").Player) =>
 *   void | Promise<void>} menu
 * @param {number} delay
 */
function scheduleMenu(player, menu = openServerMenu, delay = 0) {
  system.runTimeout(() => {
    void menu(player);
  }, delay);
}

/**
 * Safely closes a CustomForm.
 *
 * @param {CustomForm} form
 */
function closeForm(form) {
  try {
    if (form.isShowing()) {
      form.close();
    }
  } catch (error) {
    console.warn("Failed to close form:", error);
  }
}

/**
 * Closes the current form and opens another menu.
 *
 * @param {CustomForm} form
 * @param {import("@minecraft/server").Player} player
 * @param {(player: import("@minecraft/server").Player) =>
 *   void | Promise<void>} menu
 */
function navigateTo(form, player, menu) {
  closeForm(form);
  scheduleMenu(player, menu);
}

/**
 * Kills the player after they intentionally close the
 * main server selector.
 *
 * @param {import("@minecraft/server").Player} player
 */
function killPlayerFromSelector(player) {
  system.run(() => {
    try {
      player.kill();
    } catch (error) {
      console.warn(
        `Failed to kill ${player.name} after closing selector:`,
        error,
      );
    }
  });
}

/**
 * Shows a CustomForm and handles how it was closed.
 *
 * @param {CustomForm} form
 * @param {import("@minecraft/server").Player} player
 * @param {{
 *   fallbackMenu?: (
 *     player: import("@minecraft/server").Player
 *   ) => void | Promise<void>,
 *   onClientClosed?: (
 *     player: import("@minecraft/server").Player
 *   ) => void | Promise<void>,
 *   retryDelay?: number
 * }} options
 */
async function showForm(
  form,
  player,
  {
    fallbackMenu = openServerMenu,
    onClientClosed,
    retryDelay = MENU_RETRY_DELAY,
  } = {},
) {
  try {
    const closeReason = await form.show();

    switch (closeReason) {
      case DataDrivenScreenClosedReason.UserBusy:
        if (fallbackMenu) {
          scheduleMenu(player, fallbackMenu, retryDelay);
        }
        break;

      case DataDrivenScreenClosedReason.ClientClosed:
        if (onClientClosed) {
          await onClientClosed(player);
        } else if (fallbackMenu) {
          scheduleMenu(player, fallbackMenu);
        }
        break;

      // Programmatic navigation closes forms from the server.
      case DataDrivenScreenClosedReason.ServerClosed:
      default:
        break;
    }
  } catch (error) {
    console.warn("Failed to show CustomForm:", error);
  }
}

/**
 * Transfers a player to a selected server.
 *
 * @param {CustomForm} form
 * @param {import("@minecraft/server").Player} player
 * @param {ServerEntry} server
 */
function joinServer(form, player, server) {
  closeForm(form);

  system.run(() => {
    try {
      transferPlayer(player, {
        hostname: server.ip,
        port: server.port,
      });
    } catch (error) {
      console.warn(
        `Failed to transfer ${player.name} to ${server.name}:`,
        error,
      );

      scheduleMenu(player, openServerMenu);
    }
  });
}

/**
 * Opens the main server selector.
 *
 * @param {import("@minecraft/server").Player} player
 */
async function openServerMenu(player) {
  setSelectorGameMode(player);

  const servers = getServers();

  const form = new CustomForm(player, "Server Selector")
    .label("Select a server to join or manage your server list.")
    .divider()
    .header("Servers")
    .spacer();

  if (servers.length === 0) {
    form.label("§7No servers have been added.");
  } else {
    for (const server of servers) {
      form.button(
        formatServerButton(server),
        () => {
          joinServer(form, player, server);
        },
        {
          tooltip: `Join ${server.name}`,
        },
      );
    }
  }

  form
    .divider()
    .header("Management")
    .spacer()
    .button("Add Server", () => {
      navigateTo(form, player, (currentPlayer) =>
        openAddServer(currentPlayer, openServerMenu),
      );
    });

  if (servers.length > 0) {
    form.button("Manage Servers", () => {
      navigateTo(form, player, openManageMenu);
    });
  }

  await showForm(form, player, {
    fallbackMenu: openServerMenu,
    onClientClosed: killPlayerFromSelector,
    retryDelay: 4,
  });
}

/**
 * Opens the add-server form.
 *
 * @param {import("@minecraft/server").Player} player
 * @param {(player: import("@minecraft/server").Player) =>
 *   void | Promise<void>} returnMenu
 */
async function openAddServer(player, returnMenu = openServerMenu) {
  setSelectorGameMode(player);

  const name = new ObservableString("", {
    clientWritable: true,
  });

  const ip = new ObservableString("", {
    clientWritable: true,
  });

  const port = new ObservableString("19132", {
    clientWritable: true,
  });

  const status = new ObservableString("");
  const statusVisible = new ObservableBoolean(false);
  const statusInvisible = new ObservableBoolean(true);

  status.subscribe((message) => {
    statusVisible.setData(message.trim().length > 0);
    statusInvisible.setData(message.trim().length == 0);
  });

  const form = new CustomForm(player, "Add Server")
    .textField("Server Name", name, {
      description: "The display name shown in the server selector.",
    })
    .textField("IP / Hostname", ip, {
      description: "Example: play.example.com",
    })
    .textField("Port", port, {
      description: "Enter a port from 1 through 65535.",
    })
    .spacer({
      visible: statusVisible,
    })
    .label(status, {
      visible: statusVisible,
    })
    .divider({
      visible: statusVisible,
    })
    .spacer({
      visible: statusInvisible,
    })
    .header("Actions")
    .spacer()
    .button("Add Server", () => {
      const server = parseServerDraft({
        name: name.getData(),
        ip: ip.getData(),
        port: port.getData(),
      });

      if (!server) {
        status.setData("§cEnter a name, hostname, and valid port.");

        return;
      }

      try {
        const servers = getServers();
        servers.push(server);

        saveServers(servers);

        navigateTo(form, player, returnMenu);
      } catch (error) {
        console.warn("Failed to add server:", error);

        status.setData("§cUnable to save the server.");
      }
    });

  await showForm(form, player, {
    fallbackMenu: returnMenu,
  });
}

/**
 * Opens the server-management form.
 *
 * @param {import("@minecraft/server").Player} player
 * @param {number} initialIndex
 */
async function openManageMenu(player, initialIndex = 0) {
  setSelectorGameMode(player);

  const savedServers = getServers();

  if (savedServers.length === 0) {
    return openServerMenu(player);
  }

  /** @type {ServerDraft[]} */
  const drafts = savedServers.map(createServerDraft);

  const startIndex = clampIndex(initialIndex, drafts.length);

  const selectedIndex = new ObservableNumber(startIndex, {
    clientWritable: true,
  });

  const name = new ObservableString(drafts[startIndex].name, {
    clientWritable: true,
  });

  const ip = new ObservableString(drafts[startIndex].ip, {
    clientWritable: true,
  });

  const port = new ObservableString(drafts[startIndex].port, {
    clientWritable: true,
  });

  const status = new ObservableString("");
  const statusVisible = new ObservableBoolean(false);
  const statusInvisible = new ObservableBoolean(true);

  status.subscribe((message) => {
    statusVisible.setData(message.trim().length > 0);
    statusInvisible.setData(message.trim().length == 0);
  });

  const moveUpDisabled = new ObservableBoolean(startIndex === 0);

  const moveDownDisabled = new ObservableBoolean(
    startIndex === drafts.length - 1,
  );

  /*
   * Each dropdown position has an observable label.
   * When servers are edited or reordered, these labels
   * update without rebuilding the form.
   */
  const dropdownLabels = drafts.map(
    (draft) => new ObservableString(formatServerDropdownItem(draft)),
  );

  const dropdownItems = dropdownLabels.map((label, index) => ({
    label,
    value: index,
  }));

  let currentIndex = startIndex;
  let loadingDraft = false;

  /**
   * Updates the disabled state of reorder buttons.
   */
  function updateMoveButtons() {
    moveUpDisabled.setData(currentIndex <= 0);

    moveDownDisabled.setData(currentIndex >= drafts.length - 1);
  }

  /**
   * Updates all dropdown labels from the current drafts.
   */
  function updateDropdownLabels() {
    for (let index = 0; index < drafts.length; index++) {
      dropdownLabels[index].setData(formatServerDropdownItem(drafts[index]));
    }
  }

  /**
   * Loads the selected draft into the text fields.
   *
   * @param {number} index
   */
  function loadDraft(index) {
    const draft = drafts[index];

    if (!draft) {
      return;
    }

    loadingDraft = true;

    name.setData(draft.name);
    ip.setData(draft.ip);
    port.setData(draft.port);

    loadingDraft = false;

    updateMoveButtons();
  }

  /**
   * Selects the first invalid server draft.
   *
   * @param {number} errorIndex
   */
  function showValidationError(errorIndex) {
    selectedIndex.setData(errorIndex);

    status.setData(`§cServer ${errorIndex + 1} has invalid details.`);
  }

  /**
   * Saves every server draft.
   *
   * @param {string} successMessage
   * @returns {ServerEntry[] | undefined}
   */
  function persistDrafts(successMessage = "§aChanges saved.") {
    const result = validateServerDrafts(drafts);

    if (!result.servers) {
      showValidationError(result.errorIndex ?? 0);

      return undefined;
    }

    try {
      saveServers(result.servers);

      if (successMessage) {
        status.setData(successMessage);
      }

      return result.servers;
    } catch (error) {
      console.warn("Failed to save server changes:", error);

      status.setData("§cUnable to save changes.");

      return undefined;
    }
  }

  /**
   * Moves the selected server up or down.
   *
   * @param {-1 | 1} direction
   */
  function moveSelectedServer(direction) {
    const validation = validateServerDrafts(drafts);

    if (!validation.servers) {
      showValidationError(validation.errorIndex ?? 0);

      return;
    }

    const previousIndex = currentIndex;
    const newIndex = previousIndex + direction;

    if (newIndex < 0 || newIndex >= validation.servers.length) {
      return;
    }

    moveItem(validation.servers, previousIndex, newIndex);

    try {
      saveServers(validation.servers);
    } catch (error) {
      console.warn("Failed to save server order:", error);

      status.setData("§cUnable to save the new order.");

      return;
    }

    /*
     * Rebuild the dropdown using the newly saved order.
     * The moved server remains selected at its new index.
     */
    navigateTo(form, player, (currentPlayer) =>
      openManageMenu(currentPlayer, newIndex),
    );
  }

  /**
   * Deletes the selected server and saves other edits.
   */
  function deleteSelectedServer() {
    const remainingDrafts = drafts.filter((_, index) => index !== currentIndex);

    const validation = validateServerDrafts(remainingDrafts);

    if (!validation.servers) {
      /*
       * Convert the remaining-draft index back into the
       * current dropdown's index.
       */
      const originalErrorIndex =
        (validation.errorIndex ?? 0) >= currentIndex
          ? (validation.errorIndex ?? 0) + 1
          : (validation.errorIndex ?? 0);

      showValidationError(originalErrorIndex);

      return;
    }

    try {
      saveServers(validation.servers);
    } catch (error) {
      console.warn("Failed to delete server:", error);

      status.setData("§cUnable to delete the server.");

      return;
    }

    if (validation.servers.length === 0) {
      navigateTo(form, player, openServerMenu);

      return;
    }

    const nextIndex = Math.min(currentIndex, validation.servers.length - 1);

    navigateTo(form, player, (currentPlayer) =>
      openManageMenu(currentPlayer, nextIndex),
    );
  }

  /*
   * Load a server whenever the dropdown selection changes.
   */
  selectedIndex.subscribe((newValue) => {
    const newIndex = clampIndex(newValue, drafts.length);

    if (newIndex !== newValue) {
      selectedIndex.setData(newIndex);
      return;
    }

    currentIndex = newIndex;

    loadDraft(currentIndex);
    status.setData("");
  });

  /*
   * Keep the currently selected draft synchronized with
   * the editable form fields.
   */
  name.subscribe((newValue) => {
    if (loadingDraft || !drafts[currentIndex]) {
      return;
    }

    drafts[currentIndex].name = newValue;

    dropdownLabels[currentIndex].setData(
      formatServerDropdownItem(drafts[currentIndex]),
    );
  });

  ip.subscribe((newValue) => {
    if (loadingDraft || !drafts[currentIndex]) {
      return;
    }

    drafts[currentIndex].ip = newValue;

    dropdownLabels[currentIndex].setData(
      formatServerDropdownItem(drafts[currentIndex]),
    );
  });

  port.subscribe((newValue) => {
    if (loadingDraft || !drafts[currentIndex]) {
      return;
    }

    drafts[currentIndex].port = newValue;

    dropdownLabels[currentIndex].setData(
      formatServerDropdownItem(drafts[currentIndex]),
    );
  });

  const form = new CustomForm(player, "Manage Servers")
    .dropdown("Selected Server", selectedIndex, dropdownItems, {
      description: "Choose a server to edit, reorder, or delete.",
    })
    .spacer()
    .header("Server Details")
    .spacer()
    .textField("Server Name", name, {
      description: "The display name shown in the selector.",
    })
    .textField("IP / Hostname", ip, {
      description: "Example: play.example.com",
    })
    .textField("Port", port, {
      description: "Enter a port from 1 through 65535.",
    })
    .spacer({
      visible: statusVisible,
    })
    .label(status, {
      visible: statusVisible,
    })
    .divider({
      visible: statusVisible,
    })
    .spacer({
      visible: statusInvisible,
    })
    .header("Actions")
    .spacer()
    .button(
      "Move Up",
      () => {
        moveSelectedServer(-1);
      },
      {
        disabled: moveUpDisabled,
        tooltip: "Move this server higher in the selector.",
      },
    )
    .button(
      "Move Down",
      () => {
        moveSelectedServer(1);
      },
      {
        disabled: moveDownDisabled,
        tooltip: "Move this server lower in the selector.",
      },
    )
    .button("Delete Server", () => {
      deleteSelectedServer();
    });

  await showForm(form, player, {
    fallbackMenu: openServerMenu,
    onClientClosed: (player) => {
      persistDrafts("");
      navigateTo(form, player, openServerMenu);
    },
  });
}

world.afterEvents.worldLoad.subscribe(() => {
  // Keep the death screen open so the player can exit.
  world.gameRules.doImmediateRespawn = false;
});

/**
 * Opens the selector whenever a player joins or respawns.
 */
world.afterEvents.playerSpawn.subscribe(({ player }) => {
  /*
   * Waiting until the next tick ensures the player has
   * entered the world before changing mode and opening UI.
   */
  system.run(() => {
    setSelectorGameMode(player);
    void openServerMenu(player);
  });
});
