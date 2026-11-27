# US market notes (checklist, not legal advice)

Everything marked "verify" needs a US transportation or privacy attorney before launch.

## Terms and documents
- Use US terms: lane, FTL, LTL, accessorials, detention, lumper, liftgate.
- Standard documents: bill of lading (BOL), proof of delivery (POD) and the **rate confirmation** for spot freight. CMR is European and not relevant.
- LTL pricing uses freight classes (NMFC). Fuel surcharges are commonly indexed to a weekly US diesel price average. Verify details with a design partner.
- Units: miles, pounds, USD. Pallets are commonly 48 x 40 inches.

## Brokerage rules (important for Spot Freight)
Arranging freight for compensation can require FMCSA property broker authority (MC number) and a financial security bond. Loadlane is designed as software where the shipper picks its own carriers and no money flows through Loadlane. Verify with a transportation attorney before launching any marketplace-like feature.

## Privacy and communication
- No single federal privacy law, but several state laws (for example California). Precise location is typically treated as sensitive data. Keep a consent log and a deletion process. Verify.
- Texting drivers needs consent (TCPA). SMS providers require registration for business messaging. Verify.
- If drivers in the EU appear, GDPR applies as well.

## Integrations common in the US
- EDI X12: 204 (load tender), 990 (tender response), 214 (shipment status), 210 (freight invoice).
- Carriers usually run an ELD provider (for example Samsara or Motive). Location data from them needs carrier consent and an API agreement.
- Carriers are identified by USDOT and MC numbers. Carrier verification can be added later.

## Company and trust
- Entity form, banking, Stripe and sales tax: decide with a US advisor.
- Enterprise buyers will ask for SOC 2. Collect evidence early (access control, logging, backups, change management).
- Check the name Loadlane (USPTO) and the domain before public launch.
- Residence and work authorization for you personally are a separate topic for an immigration attorney. A company alone does not grant a visa.
- Clear side-business rules with your current employer first. Use no employer data, contacts or internal processes.
