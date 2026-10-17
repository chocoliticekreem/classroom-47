// Three example cases for the "New case" page, copied from the public sample cases in
// data/cases/delivery (024, 029, 003): only the messages up to the moment the desk is asked,
// never the case title, notes or the expected answer.
import type { DraftMessage } from "./request";

export interface IntakeExample {
  id: string;
  label: string;
  /** Goes into the paste box, as an email would be pasted. */
  paste: string;
  /** Added one by one, as if typed into the form. */
  messages: DraftMessage[];
}

const DESK = "Iona Quill, Rivet Delivery Desk";

export const EXAMPLES: IntakeExample[] = [
  {
    id: "delivery-024",
    label: "Says delivered, but no parcel",
    paste: [
      "From: Tracking support, Plover Arc Logistics",
      `To: ${DESK}`,
      "Date: 2026-02-25 09:00 UTC",
      "",
      "DL-024 displays delivered at 08:10 UTC today. We have not reviewed the handover record or route stop. Only the shipment and recipient account match are verified.",
    ].join("\n"),
    messages: [
      {
        channel: "Customer portal",
        from: "Sorin Vaal, recipient",
        to: DESK,
        subject: null,
        date: "2026-02-25T09:10:00.000Z",
        body: "No one in my household has the parcel. I see delivered on the tracker. Please have the carrier investigate where it went.",
      },
    ],
  },
  {
    id: "delivery-029",
    label: "Chilled food arrived too warm",
    paste: [
      "From: Brineleaf Pantry food-safety intake",
      `To: ${DESK}`,
      "Date: 2026-03-02 09:00 UTC",
      "",
      "Order BP-029 / DL-029 uses our documented chilled-delivery range of 0–5 °C at handover. Inline logger excerpt: sensor BL-29, handover capture 2026-03-02 08:50 UTC, 9.2 °C. This is outside our range; only food-safety staff may authorise disposition.",
    ].join("\n"),
    messages: [
      {
        channel: "Customer portal",
        from: "Enna Vosk, recipient",
        to: DESK,
        subject: null,
        date: "2026-03-02T09:10:00.000Z",
        body: "I have not eaten anything from this box. The logger shows 9.2 °C. Please get the merchant to tell me what to do and whether they will replace it.",
      },
    ],
  },
  {
    id: "delivery-003",
    label: "Driver stuck at a locked gate",
    paste: "",
    messages: [
      {
        channel: "Driver chat",
        from: "Route driver Fen Orlo, Plover Arc Logistics",
        to: DESK,
        subject: null,
        date: "2026-02-04T09:00:00.000Z",
        body: "I am at 7 Sedgeglass Mews for DL-003. The pedestrian gate is shut and there are no public access instructions. I am waiting outside; I have not left the parcel.",
      },
      {
        channel: "Dispatch chat",
        from: "Dispatch, Plover Arc Logistics",
        to: DESK,
        subject: null,
        date: "2026-02-04T09:10:00.000Z",
        body: "Please contact recipient Elva Kesh on the verified order callback route. Do not request a reusable gate code. The driver can wait until 10:00 UTC.",
      },
    ],
  },
];
