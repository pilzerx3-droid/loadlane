import type { OrganizationDetail } from "../lib/api-client";

const REGION: Record<OrganizationDetail["region"], string> = {
  us: "United States",
  eu: "European Union",
};
const DISTANCE: Record<OrganizationDetail["distanceUnit"], string> = {
  mi: "Miles",
  km: "Kilometers",
};
const WEIGHT: Record<OrganizationDetail["weightUnit"], string> = {
  lb: "Pounds",
  kg: "Kilograms",
};

export function describeOrganization(organization: OrganizationDetail): [string, string][] {
  return [
    ["Name", organization.name],
    ["Short name", organization.slug],
    ["Region", REGION[organization.region]],
    ["Distance unit", DISTANCE[organization.distanceUnit]],
    ["Weight unit", WEIGHT[organization.weightUnit]],
    ["Currency", organization.currency],
    ["Locale", organization.locale],
    ["Time zone", organization.timezone],
  ];
}

/** Read-only list of the organization's settings. */
export function OrganizationDetails({ organization }: { organization: OrganizationDetail }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {describeOrganization(organization).map(([term, value]) => (
        <div key={term}>
          <dt className="text-xs font-semibold text-muted-foreground">{term}</dt>
          <dd className="mt-0.5 font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
