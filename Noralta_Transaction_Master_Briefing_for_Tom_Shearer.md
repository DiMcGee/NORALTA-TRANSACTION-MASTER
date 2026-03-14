NORALTA TRANSACTION MASTER
Briefing for Tom Shearer, Broker/Owner
Royal LePage Noralta Real Estate -- Edmonton, AB
Prepared by Diana McGee | February 2026

---

WHAT IS THIS?

Noralta Transaction Master is a web-based transaction management system built from the ground up for Royal LePage Noralta Real Estate. It replaces the current paper-and-email workflow -- where agents fill out AREA forms by hand or in separate PDFs, track deal status on spreadsheets, and email documents back and forth -- with a single, centralized platform that handles forms, deal tracking, compliance, and document generation in one place.

The system is live and accessible from any browser, on any device:
https://noralta-transaction-master.vercel.app

---

WHAT HAS BEEN BUILT

1. 44 Digital Forms Covering the Entire Deal Lifecycle

Every form an agent needs is built into the system, organized by transaction type:

Residential (core AREA forms): Buyer Rep Agreement, Seller Rep Agreement, Purchase Contract, Country Residential Purchase Contract, Amendments, Addendums, Dual Agency Agreement, Remuneration Agreement, Consumer Relationships Guide, Consent forms, and Notices.

Commercial: Buyer Rep, Landlord Rep, Purchase Contract, Offer to Lease, and Dual Agency.

FINTRAC Compliance (7 forms): Individual Identification, Corporate Identification, Beneficial Ownership Declaration, Brokerage Risk Assessment, Managed Account Record, PEP Determination, and Receipt of Funds. These are the forms FINTRAC requires for anti-money-laundering compliance.

Office and Admin (10 forms): Listing Activity Sheet, Builder Referral, Cancellation Notice, EFT Authorization, Listing Sheet, Referral Agreement, Personal Trade Declaration, New Agent Registration, Title Search Request, and Transaction Information Sheet.

When an agent opens a deal, the system automatically shows them the right set of forms for that transaction type. No more guessing which forms are needed or discovering a missing form after the deal closes.


2. Smart Data Reuse -- Type It Once, It Appears Everywhere

This is the single biggest time-saver in the system.

In a typical residential purchase, an agent fills out 10 to 15 forms. Today, they re-type the buyer's name, the property address, the purchase price, and other common information on every single form. That means the same buyer name gets typed 15 times, the same address gets typed 15 times, and so on.

With Noralta Transaction Master, the agent types each piece of information once. When they enter the buyer's name on the Buyer Rep Agreement, that name automatically appears on the Purchase Contract, every Amendment, every Notice, every Consent form -- everywhere that buyer's name belongs. The same applies to seller names, property addresses, brokerage details, agent information, lawyer information, and more.

The system manages 31 groups of shared data, covering six different patterns of how information flows between forms. This was the most technically complex part of the build, and it is working across all core AREA forms today.


3. PDF Generation and Document Packages

Every form in the system can be downloaded as a clean, professional PDF document. The system supports two modes:

Data Sheet mode generates a formatted summary PDF for any form. This works today for all 44 forms.

Template Fill mode overlays the agent's data directly onto the official AREA PDF form templates, producing a document that looks exactly like the familiar AREA form but with all fields filled in. This capability is built and ready -- it will be activated once Diana provides the AREA PDF template files.

Conveyancing Package allows an agent or broker to download every form for a deal as a single ZIP file. This is useful for sending a complete deal package to a lawyer, for office records, or for compliance audits.


4. Deal Dashboard for Agents

Each agent has a personal dashboard showing all their active deals. For each deal, they can see:

- The current status (Draft, Active, Conditional, Firm, or Closed)
- Which forms are applicable to that deal
- A completion percentage for each form
- What fields are still left to fill

This gives agents a clear picture of where every deal stands and what work remains.


5. Broker Dashboard for Office Oversight

Diana and any designated brokers have a dashboard that shows every active deal across the entire office. This provides:

- Real-time visibility into which deals are in progress, which are conditional, and which have closed
- Form completion status for every deal, so you can see at a glance whether an agent has finished their paperwork
- Alerts when forms reach 100% completion or when deal status changes
- The ability to manage agent assignments and monitor workload

This means no more chasing agents to ask "did you finish the FINTRAC forms?" or "where is the amendment for the Smith deal?" -- the answer is visible on the dashboard in real time.


6. Bulk Pre-Fill for Fast Deal Setup

When creating a new deal, agents can enter the core information upfront: buyer and seller names, property address, purchase price, and key dates. This information immediately populates across every applicable form in the deal. The agent can then open any form and the foundational data is already there -- they just fill in the form-specific details.


7. Signature Capture

Agents can draw their signature on-screen using a mouse on desktop or a finger on a phone. The signature is saved to their profile and can be embedded into generated PDFs. This moves the office one step closer to fully digital closings.


8. In-App Notifications

The system sends notifications to keep everyone informed:

- Brokers are notified when a deal status changes (goes firm, closes)
- Brokers are notified when forms are completed
- Agents are notified of deal handoffs and assignments


9. Multi-Office Support

Noralta operates from four office locations: Edmonton, Spruce Grove, Fort Saskatchewan, and Sherwood Park. When an agent selects their office, the correct office address and phone number automatically populate on all forms. No more agents accidentally using the wrong office letterhead or contact information.


10. Mobile-Friendly Design

The entire system works on phones and tablets. Forms have collapsible sections, large touch-friendly buttons, and sticky navigation. Agents can fill out forms on-site at showings, open houses, or client meetings -- not just when they are back at their desk.

---

WHY THIS MATTERS FOR THE BROKERAGE

Time Savings

A typical residential purchase deal involves approximately 15 forms. Previously, agents re-typed common information (buyer name, address, price, dates) on every form. With the reuse engine, they type it once. Conservative estimate: 30 to 60 minutes saved per deal on data entry alone. Across an office doing hundreds of deals per year, this adds up to significant recovered time that agents can spend with clients instead.

Error Reduction

When data is entered once and shared automatically across forms, typos and inconsistencies between documents are eliminated. No more situations where the property address on the purchase contract does not match the address on the amendment, or where the buyer's name is spelled differently on two forms. Cleaner paperwork means fewer issues at closing and fewer compliance concerns.

Compliance

FINTRAC compliance forms are built directly into the deal workflow. Instead of being a separate process that agents forget about, compliance paperwork is part of the same form chain as every other deal document. Brokers can see at a glance which agents have completed their compliance forms and which have not. This is a meaningful risk reduction for the brokerage.

Visibility and Accountability

The broker dashboard gives Tom and Diana real-time insight into every active deal in the office. Which deals are moving forward, which are stalled, which agents have completed their paperwork, and which need follow-up -- all visible without a single phone call or email. This level of oversight is not possible with the current paper-and-email process.

Paperless Operations

All forms are digital with PDF export capability. This reduces reliance on filing cabinets, eliminates lost paperwork, and makes it simple to produce a complete deal file for audits, legal review, or office records.

Agent Onboarding

New agents joining the brokerage get a structured, guided workflow instead of having to figure out which forms they need for each type of transaction. The system presents the right forms in the right order, reducing the learning curve and the chance of missing required documentation.

---

CURRENT STATUS

- All 44 forms are live and functional
- The data reuse engine is working across all core AREA residential forms (buyer, seller, property, agent, brokerage, and lawyer information)
- A comprehensive audit is underway to extend data sharing to FINTRAC forms, the Country Residential contract, and certain commercial form fields
- PDF template fill mode is built and ready, awaiting the AREA PDF template files from Diana
- The system is hosted on reliable cloud infrastructure (Vercel for the front end, Railway for the back end and database)

---

WHAT COMES NEXT

Near-term (in progress):
- Closing the remaining data-sharing gaps identified in the audit, particularly for FINTRAC auto-fill and commercial forms
- Integrating the official AREA PDF templates once Diana provides the files, so generated documents match the exact AREA form layout

Future considerations:
- Any additional workflow features or reports Tom and Diana identify after using the system
- Potential integration with other tools the brokerage uses
- E-signature workflow for client-facing documents

---

HOW TO SEE IT

The system is live at: https://noralta-transaction-master.vercel.app

Diana can set up a login for Tom, or he can use the existing test account to explore the system. It works in any web browser on desktop, tablet, or phone -- no software installation required.

---

This system was designed specifically for Royal LePage Noralta Real Estate. It reflects the actual forms your agents use, the actual office locations you operate from, and the actual workflows Diana manages every day. The goal is straightforward: less time on paperwork, fewer errors, better compliance, and complete visibility into every deal in the office.
