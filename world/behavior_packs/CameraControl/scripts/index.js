import {
  system,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from "@minecraft/server";

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand(
    {
      name: "cameracontrol:setcamera",
      description:
        "Sets a player's camera position, rotation, and field of view.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,

      mandatoryParameters: [
        {
          name: "players",
          type: CustomCommandParamType.PlayerSelector,
        },
        {
          name: "position",
          type: CustomCommandParamType.Location,
        },
        {
          name: "pitch",
          type: CustomCommandParamType.Float,
        },
        {
          name: "yaw",
          type: CustomCommandParamType.Float,
        },
        {
          name: "fov",
          type: CustomCommandParamType.Float,
        },
      ],
    },

    (_origin, players, position, pitch, yaw, fov) => {
      if (!players?.length) {
        return {
          status: CustomCommandStatus.Failure,
          message: "No players matched the selector.",
        };
      }

      if (fov < 1 || fov > 179) {
        return {
          status: CustomCommandStatus.Failure,
          message: "FOV must be between 1 and 179.",
        };
      }

      system.run(() => {
        for (const player of players) {
          try {
            player.camera.setCamera("minecraft:free", {
              location: {
                x: position.x,
                y: position.y,
                z: position.z,
              },
              rotation: {
                x: pitch,
                y: yaw,
              },
            });

            player.runCommand(`camera @s fov_set ${fov}`);
          } catch (error) {
            console.error(`Could not set camera for ${player.name}: ${error}`);
          }
        }
      });

      return {
        status: CustomCommandStatus.Success,
        message:
          `Camera set for ${players.length} player(s) at ` +
          `${position.x}, ${position.y}, ${position.z}.`,
      };
    },
  );

  customCommandRegistry.registerCommand(
    {
      name: "cameracontrol:clearcamera",
      description: "Restores a player's normal camera and FOV.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,

      mandatoryParameters: [
        {
          name: "players",
          type: CustomCommandParamType.PlayerSelector,
        },
      ],
    },

    (_origin, players) => {
      if (!players?.length) {
        return {
          status: CustomCommandStatus.Failure,
          message: "No players matched the selector.",
        };
      }

      system.run(() => {
        for (const player of players) {
          try {
            player.camera.clear();
            player.runCommand("camera @s fov_clear");
          } catch (error) {
            console.error(
              `Could not clear camera for ${player.name}: ${error}`,
            );
          }
        }
      });

      return {
        status: CustomCommandStatus.Success,
        message: `Camera cleared for ${players.length} player(s).`,
      };
    },
  );
});
