import { localTimeToIso } from "@loadlane/shared";

export interface StopValues {
  type: "pickup" | "delivery";
  locationId: string;
  /** Local date and time at the location, as a datetime-local field holds it. */
  start: string;
  end: string;
  reference: string;
}

export interface TransportFormValues {
  customerId: string;
  carrierId: string;
  customerReference: string;
  purchaseOrder: string;
  weightLb: string;
  pieces: string;
  notes: string;
  stops: StopValues[];
}

export function emptyStop(type: StopValues["type"]): StopValues {
  return { type, locationId: "", start: "", end: "", reference: "" };
}

export function emptyTransportForm(): TransportFormValues {
  return {
    customerId: "",
    carrierId: "",
    customerReference: "",
    purchaseOrder: "",
    weightLb: "",
    pieces: "",
    notes: "",
    stops: [emptyStop("pickup"), emptyStop("delivery")],
  };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const MAX_STOPS = 20;

/** Reads the transport form. Stop rows are named `stops.0.locationId`, `stops.1.start` and so on. */
export function parseTransportForm(formData: FormData): TransportFormValues {
  const stops: StopValues[] = [];
  for (let index = 0; index < MAX_STOPS; index++) {
    const prefix = `stops.${index}.`;
    if (!formData.has(`${prefix}locationId`)) break;
    stops.push({
      type: text(formData, `${prefix}type`) === "delivery" ? "delivery" : "pickup",
      locationId: text(formData, `${prefix}locationId`),
      start: text(formData, `${prefix}start`),
      end: text(formData, `${prefix}end`),
      reference: text(formData, `${prefix}reference`),
    });
  }
  return {
    customerId: text(formData, "customerId"),
    carrierId: text(formData, "carrierId"),
    customerReference: text(formData, "customerReference"),
    purchaseOrder: text(formData, "purchaseOrder"),
    weightLb: text(formData, "weightLb"),
    pieces: text(formData, "pieces"),
    notes: text(formData, "notes"),
    stops,
  };
}

export type FormErrors = Record<string, string>;

/**
 * Turns the form into the API's input. Times are read in the time zone of each stop's location
 * (`timezones` maps location id to zone). Problems are returned per field, named like the form fields.
 */
export function buildTransportInput(
  values: TransportFormValues,
  timezones: Readonly<Record<string, string>>,
): { input: Record<string, unknown>; errors: FormErrors } {
  const errors: FormErrors = {};

  if (values.customerId === "") errors["customerId"] = "Choose a customer.";

  let weightLb: number | null = null;
  if (values.weightLb !== "") {
    weightLb = Number(values.weightLb.replaceAll(",", ""));
    if (!Number.isFinite(weightLb) || weightLb <= 0)
      errors["weightLb"] = "Enter a weight in pounds, greater than 0.";
  }
  let pieces: number | null = null;
  if (values.pieces !== "") {
    pieces = Number(values.pieces);
    if (!Number.isInteger(pieces) || pieces <= 0)
      errors["pieces"] = "Enter a whole number, greater than 0.";
  }

  const stops = values.stops.map((stop, index) => {
    const zone = timezones[stop.locationId];
    if (stop.locationId === "" || zone === undefined) {
      errors[`stops.${index}.locationId`] = "Choose a location.";
    }
    const start = zone ? localTimeToIso(stop.start, zone) : undefined;
    const end = zone ? localTimeToIso(stop.end, zone) : undefined;
    if (zone && start === undefined) errors[`stops.${index}.start`] = "Enter a date and time.";
    if (zone && end === undefined) errors[`stops.${index}.end`] = "Enter a date and time.";
    if (start && end && new Date(end) < new Date(start)) {
      errors[`stops.${index}.end`] = "The window cannot end before it starts.";
    }
    return {
      type: stop.type,
      locationId: stop.locationId,
      windowStart: start ?? "",
      windowEnd: end ?? "",
      reference: stop.reference,
    };
  });
  if (values.stops.length < 2) errors["stops"] = "Add at least a pickup and a delivery.";

  return {
    input: {
      customerId: values.customerId,
      carrierId: values.carrierId === "" ? null : values.carrierId,
      customerReference: values.customerReference,
      purchaseOrder: values.purchaseOrder,
      weightLb,
      pieces,
      notes: values.notes,
      stops,
    },
    errors,
  };
}

/** The form field an API error path belongs to: `stops.1.windowEnd` is the `end` field of the second stop. */
export function formFieldFor(apiPath: string): string {
  return apiPath
    .replace(/^stops\.(\d+)\.windowStart$/, "stops.$1.start")
    .replace(/^stops\.(\d+)\.windowEnd$/, "stops.$1.end");
}
