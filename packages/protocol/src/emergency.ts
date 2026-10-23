/** Kinds of emergency a screen can show. Adding one also needs its icon and alarm in the door unit. */
export const EMERGENCY_KINDS = ["fire", "biohazard", "nuclear", "bomb", "seismic", "power"] as const;
export type EmergencyKind = (typeof EMERGENCY_KINDS)[number];

export interface EmergencyInfo {
  /** Short heading under the icon, also the name in the console. */
  title: string;
  /** What to do, in a few short sentences: this is read at a glance while moving. */
  instructions: string;
  /** Accent colour of the console card and of the door screen. */
  color: string;
  /** A power cut is not life-threatening: its alarm is a soft chime, not a siren. */
  loud: boolean;
}

/** Default wording and look of each emergency. The server sends it with `emergency.set`. */
export const EMERGENCY_CATALOGUE: Record<EmergencyKind, EmergencyInfo> = {
  fire: {
    title: "Fire alarm",
    instructions: "Leave the building now by the nearest exit. Do not use lifts. Close doors behind you and go to the assembly point.",
    color: "#ff5a36",
    loud: true,
  },
  biohazard: {
    title: "Biohazard alarm",
    instructions: "Stay where you are and keep doors and windows closed. Do not touch anything suspicious. Wait for instructions from staff.",
    color: "#b4e61d",
    loud: true,
  },
  nuclear: {
    title: "Radiation leak alarm",
    instructions: "Go inside and stay inside. Close doors and windows, move away from outer walls, and wait for official instructions.",
    color: "#ffd21f",
    loud: true,
  },
  bomb: {
    title: "Bomb threat alarm",
    instructions: "Leave calmly by the nearest exit and move well away from the building. Do not touch unknown objects. Do not use your phone near the building.",
    color: "#ff2d55",
    loud: true,
  },
  seismic: {
    title: "Earthquake alarm",
    instructions: "Drop, cover and hold on under a sturdy table, away from windows. Do not run outside. Evacuate only once the shaking has stopped.",
    color: "#ff9f1c",
    loud: true,
  },
  power: {
    title: "Power cut",
    instructions: "Stay calm and stay where you are. Emergency lighting is on. Do not use lifts. Follow staff instructions.",
    color: "#3ea6ff",
    loud: false,
  },
};
