/** Editable scenario starters, not answer keys or precomputed decisions. */
export const DEMO_SCENARIOS = [
  {
    label: "Delivery 003: locked gate",
    text: "From: Route driver Fen Orlo, Plover Arc Logistics\nTo: Iona Quill, Rivet Delivery Desk\nChannel: Dispatch chat\nDate: 2026-02-04 09:00 UTC\n\nI am at 7 Sedgeglass Mews for DL-003. The pedestrian gate is shut and there are no public access instructions. I am waiting outside; I have not left the parcel.\n\nFrom: Dispatch, Plover Arc Logistics\nTo: Iona Quill, Rivet Delivery Desk\nChannel: Dispatch chat\nDate: 2026-02-04 09:10 UTC\n\nPlease contact recipient Elva Kesh on the verified order callback route. Do not request a reusable gate code. The driver can wait until 10:00 UTC."
  },
  {
    label: "Crash + changed availability",
    text: "From: Dispatch, Cedarway Logistics\nTo: Rivet Delivery Desk\nChannel: Email\nDate: 2026-10-10 09:00 UTC\n\nOrder DEMO-101: the van crashed, nobody was injured, and it cannot continue. We can offer Sunday 11 October 09:00–12:00 UTC. Dispatch owns capacity and booking confirmation. No replacement booking exists.\n\nFrom: Mira, verified recipient\nTo: Rivet Delivery Desk\nChannel: Customer portal\nDate: 2026-10-10 09:05 UTC\n\nSunday morning does not work. I can receive Monday 12 October 11:00–12:00 UTC only. Please check that window instead."
  },
  {
    label: "Cold-chain clearance",
    text: "From: Warehouse, Meadow Kitchen\nTo: Rivet Delivery Desk\nChannel: Incident chat\nDate: 2026-10-10 09:00 UTC\n\nOrder DEMO-102 contains chilled meals. Refrigeration failed and the logger recorded 11°C for 75 minutes. Food-safety lead, Meadow Kitchen owns the release decision through this incident chat. No clearance exists.\n\nFrom: Dispatch\nTo: Rivet Delivery Desk\nChannel: Email\nDate: 2026-10-10 09:05 UTC\n\nA replacement van is available for Monday 11:00–12:00 UTC. Please tell us when release is authorised.\n\nFrom: Mira, verified recipient\nTo: Rivet Delivery Desk\nChannel: Customer portal\nDate: 2026-10-10 09:10 UTC\n\nMonday works, but only if the food-safety owner clears these meals."
  },
  {
    label: "Human authority",
    text: "From: Exception desk, Cedarway Logistics\nTo: Rivet Delivery Desk\nChannel: Email\nDate: 2026-10-10 09:00 UTC\n\nOrder DEMO-103 returns to sender on 11 October at 16:00 UTC unless the verified recipient chooses a supported alternative. Only the verified recipient can authorise a delivery change.\n\nFrom: Alex, relative using the recipient account\nTo: Rivet Delivery Desk\nChannel: Customer portal\nDate: 2026-10-10 09:05 UTC\n\nThe recipient has died. I am their relative. Please redirect the parcel to my address and refund the fee. I have not supplied proof that I can act for them."
  }
];

export const DEMO_REPLIES = [
  { label: "Recipient can admit driver", text: "From: Elva Kesh, recipient\nTo: Iona Quill, Rivet Delivery Desk\nChannel: Call transcript\nDate: 2026-02-04 09:35 UTC\n\nI can see the courier on the intercom. I will release the gate and meet them in the lobby now." },
  { label: "Driver confirms handover", text: "From: Route driver Fen Orlo, Plover Arc Logistics\nTo: Iona Quill, Rivet Delivery Desk\nChannel: Dispatch chat\nDate: 2026-02-04 10:05 UTC\n\nGate access was granted from inside. Elva Kesh met me in the lobby and received DL-003 at 09:48 UTC; the matching handover scan is complete." },
  { label: "Recipient unavailable", text: "From: Elva Kesh, verified recipient\nTo: Iona Quill, Rivet Delivery Desk\nChannel: Call transcript\nDate: 2026-02-04 09:35 UTC\n\nI cannot come to the gate today. I can receive tomorrow 10:00–12:00 UTC only. Please check with Dispatch for a supported alternative. Do not leave the parcel outside." }
];
