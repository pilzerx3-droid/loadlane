// Master data the web app manages: what each kind is called, which permissions it needs and which
// fields its form has. The API validates everything again; this only drives the screens.

export type MasterDataKey = "customers" | "carriers" | "locations";

export interface FieldSpec {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "select";
  required?: boolean;
  maxLength?: number;
  hint?: string;
  autoComplete?: string;
  options?: readonly { value: string; label: string }[];
}

export interface ColumnSpec {
  key: string;
  label: string;
}

export interface MasterDataConfig {
  key: MasterDataKey;
  /** API path, also the page path. */
  path: string;
  singular: string;
  plural: string;
  description: string;
  read: string;
  manage: string;
  fields: readonly FieldSpec[];
  columns: readonly ColumnSpec[];
}

export const US_TIME_ZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
] as const;

const contact: FieldSpec[] = [
  { name: "contactName", label: "Contact name", type: "text", maxLength: 120, autoComplete: "off" },
  {
    name: "contactEmail",
    label: "Contact e-mail",
    type: "email",
    maxLength: 254,
    autoComplete: "off",
  },
  { name: "contactPhone", label: "Contact phone", type: "tel", maxLength: 40, autoComplete: "off" },
];

const notes: FieldSpec = { name: "notes", label: "Notes", type: "textarea", maxLength: 2000 };

export const MASTER_DATA: Readonly<Record<MasterDataKey, MasterDataConfig>> = {
  customers: {
    key: "customers",
    path: "/customers",
    singular: "customer",
    plural: "Customers",
    description: "Companies you ship for",
    read: "customer:read",
    manage: "customer:manage",
    fields: [
      { name: "name", label: "Company name", type: "text", required: true, maxLength: 120 },
      ...contact,
      notes,
    ],
    columns: [
      { key: "name", label: "Name" },
      { key: "contactName", label: "Contact" },
      { key: "contactEmail", label: "E-mail" },
    ],
  },
  carriers: {
    key: "carriers",
    path: "/carriers",
    singular: "carrier",
    plural: "Carriers",
    description: "Trucking companies you work with",
    read: "carrier:read",
    manage: "carrier:manage",
    fields: [
      { name: "name", label: "Company name", type: "text", required: true, maxLength: 120 },
      {
        name: "mcNumber",
        label: "MC number",
        type: "text",
        maxLength: 20,
        hint: "Stored as typed. Loadlane does not verify it.",
      },
      {
        name: "dotNumber",
        label: "USDOT number",
        type: "text",
        maxLength: 20,
        hint: "Stored as typed. Loadlane does not verify it.",
      },
      ...contact,
      notes,
    ],
    columns: [
      { key: "name", label: "Name" },
      { key: "mcNumber", label: "MC" },
      { key: "dotNumber", label: "USDOT" },
      { key: "contactName", label: "Contact" },
    ],
  },
  locations: {
    key: "locations",
    path: "/locations",
    singular: "location",
    plural: "Locations",
    description: "Places where freight is picked up or delivered",
    read: "location:read",
    manage: "location:manage",
    fields: [
      {
        name: "name",
        label: "Name",
        type: "text",
        required: true,
        maxLength: 120,
        hint: "For example the warehouse or dock.",
      },
      {
        name: "addressLine1",
        label: "Address",
        type: "text",
        required: true,
        maxLength: 200,
        autoComplete: "off",
      },
      {
        name: "addressLine2",
        label: "Address line 2",
        type: "text",
        maxLength: 200,
        autoComplete: "off",
      },
      {
        name: "city",
        label: "City",
        type: "text",
        required: true,
        maxLength: 100,
        autoComplete: "off",
      },
      {
        name: "state",
        label: "State",
        type: "text",
        required: true,
        maxLength: 2,
        hint: "Two letters, for example TX.",
        autoComplete: "off",
      },
      {
        name: "postalCode",
        label: "ZIP code",
        type: "text",
        required: true,
        maxLength: 10,
        autoComplete: "off",
      },
      {
        name: "timezone",
        label: "Time zone",
        type: "select",
        required: true,
        hint: "Pickup and delivery windows are read in this time zone.",
        options: US_TIME_ZONES,
      },
      notes,
    ],
    columns: [
      { key: "name", label: "Name" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "postalCode", label: "ZIP" },
    ],
  },
};

export function isMasterDataKey(value: string): value is MasterDataKey {
  return Object.hasOwn(MASTER_DATA, value);
}

/** What the person typed, as the API expects it. Blanks around values are removed; empty optional fields stay empty strings, which the API reads as "no value". */
export function inputFromForm(
  config: MasterDataConfig,
  formData: FormData,
): Record<string, string> {
  const input: Record<string, string> = {};
  for (const field of config.fields) {
    const value = formData.get(field.name);
    input[field.name] = typeof value === "string" ? value.trim() : "";
  }
  return input;
}
