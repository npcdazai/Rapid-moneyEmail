// Mirrors backend/src/auth/modules.js — the Mail workspace is split into
// dashboard sections, each separately allocatable.
export const MAIL_SECTIONS = [
  "mail.main",
  "mail.status",
  "mail.qrc",
  "mail.automation",
  "mail.other",
];

// Map a FolderNav folder (by its `group`) to the section module that gates it.
export function sectionForFolder(f) {
  switch (f.group) {
    case "main":
      return "mail.main";
    case "status":
      return "mail.status";
    case "qrc":
    case "child":
      return "mail.qrc";
    case "automation":
      return "mail.automation";
    case "other":
      return "mail.other";
    default:
      return "mail.main";
  }
}

/** True if the user holds at least one Mail section. */
export const hasAnyMail = (mods = []) => MAIL_SECTIONS.some((s) => mods.includes(s));
