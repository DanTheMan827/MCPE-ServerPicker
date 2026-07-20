# Server Picker

A Minecraft Bedrock Edition behavior pack that provides a simple in-game server browser, primarily designed for **console players**.

Since Minecraft on consoles does not allow players to directly add or join custom servers, this pack lets players select a server from a predefined list and transfers them using the Bedrock `transferPlayer()` API.

> **This pack is intended to be used in a local world—not on a Realm.**

---

## Why?

Bedrock Edition on Xbox, PlayStation, and Nintendo Switch does not include a way to connect to arbitrary servers like Windows, Android, or iOS.

Server Picker works around this by presenting a server selection menu inside a world, allowing players to transfer directly to supported servers.

The intended workflow is:

1. Create or edit the world on **Windows** or **mobile**.
2. Add or configure your server list.
3. Upload the world to a **Realm**.
4. Open the world from the console via the Realm.
5. The add-on transfers the player to the selected server.

The add-on itself **should not remain hosted on the Realm**, as server transfers are not supported from within Realms.

---

## Features

- 🎮 Designed specifically for console players
- 🌐 Join custom Bedrock servers without using custom DNS settings
- 📋 Server selection menu
- ➕ Add new servers in-game
- 🗑️ Delete saved servers
- 💾 Stores the shared server list in world dynamic properties
- ⚡ Uses the official Bedrock `transferPlayer()` API

---

## Current Limitations

### Realms

**This add-on is not intended to run from a Realm.**

Use a Realm only as a temporary method to copy the world onto a console.

Server transfers from within a Realm are currently unsupported.

### Experimental Features Required

At the time of writing, the Bedrock Server Admin API (`@minecraft/server-admin`) is still experimental.

Because of this:

- The world must have **Experiments enabled**.
- The add-on cannot currently be used in a standard non-experimental world.

Once Mojang promotes the API to stable, this requirement can likely be removed.

---

## Requirements

- Minecraft Bedrock Edition **26.33+**
- "Beta APIs" experiment enabled in world
- `@minecraft/server-admin` support (not available on Realms)

---

## Installation

1. Import the behavior pack.
2. Enable it on an **experimental world**.
3. Join the world.
4. The server selector opens automatically.

---

## Usage

### Joining a Server

Select one of the saved servers.

The add-on calls:

```js
transferPlayer(player, {
    hostname: server.ip,
    port: server.port
});
```

and Minecraft transfers the player directly.

### Adding a Server

Choose **Add Server**, then enter:

- Server name
- Hostname/IP
- Port

### Managing Servers

Choose **Manage Servers** to remove saved entries.

---

## Storage

Server Picker stores its server list in a world dynamic property.

Property key:

```
servers
```

Example:

```json
[
  {
    "name": "Survival",
    "ip": "play.example.net",
    "port": 19132
  }
]
```

Because the data is stored in the world, all players see the same server list.

---

## Roadmap

Planned improvements include:

- Edit existing servers
- Reorder server list
- Server icons
- Online status / ping
- Permission-based editing
- Import/export server lists
- Per-player server lists

---

## License

MIT License