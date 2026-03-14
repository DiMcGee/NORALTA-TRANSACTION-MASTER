# Noralta Transaction Master
## Briefing for Tom Shearer, Broker/Owner
### Noralta Real Estate / Royal LePage Noralta

**Date:** February 16, 2026
**Prepared by:** Diana McGee

---

## Executive Summary

Noralta Transaction Master is a custom-built, web-based deal management and forms completion system designed specifically for Noralta Real Estate. It digitizes 44 AREA standard forms, eliminates duplicate data entry across documents, and gives you real-time visibility into every deal across the brokerage. The system is deployed, operational, and currently being used by Diana McGee.

---

## What Was Built

| Component | Details |
|-----------|---------|
| **Web Application** | https://noralta-transaction-master.vercel.app |
| **Frontend** | Modern React interface with Tailwind CSS, mobile-friendly |
| **Backend API** | Node.js server hosted on Railway with PostgreSQL database |
| **Database** | 36-table production database covering all deal, form, party, and document data |
| **Status** | Deployed and operational |

---

## Core Features

### 1. Deal Management Dashboard

Agents log in and see a clean dashboard of all their active deals. Each deal tracks the transaction type, current status, assigned parties, and form completion progress. Deals move through clear stages: **Draft > Active > Conditional > Firm > Closed** (or Cancelled). Creating a new deal takes seconds -- select the transaction type, enter the basic details, and the system sets everything up.

### 2. 44 Digital Forms -- All AREA Standards Covered

Every AREA form your agents use has been digitized and organized by transaction type:

- **Residential transactions** -- 24 forms (representation agreements, purchase contracts, amendments, addenda, conditions, notices)
- **Commercial transactions** -- 21 forms (buyer/seller representation, purchase contracts, due diligence)
- **Lease transactions** -- 13 forms (landlord/tenant representation, offers to lease)
- **Office/Administrative** -- 10 forms (listing agreements, brokerage referrals, cancellations, EFT authorization, trade record sheets)
- **FINTRAC Compliance** -- 7 forms (individual/corporate ID verification, beneficial ownership, politically exposed persons, receipt of funds)

Forms are pre-organized so that when an agent selects "Residential Transaction," only the applicable forms appear -- no guessing about which forms are needed.

### 3. Smart Reuse Engine -- Enter Data Once, Use Everywhere

This is the single biggest time-saver in the system. There are **31 reuse groups** that share data across forms automatically:

- **Buyer/Seller info** -- name, address, phone, fax, email, date of birth
- **Property details** -- municipal address, legal description, plan/block/lot, zoning, condo info, rural land descriptions
- **Brokerage info** -- pre-populated on every document (name, address, phone, fax, email)
- **Agent details** -- auto-filled from the agent's profile
- **Lawyer contacts** -- buyer's lawyer, seller's lawyer (name, firm, address, phone, fax, email)
- **Landlord/Tenant info** -- for commercial lease transactions
- **Listing details** -- list price, listing number shared across forms
- **Search criteria** -- for buyer representation agreements

**What this means in practice:** An agent enters a buyer's name, address, and phone number on the first form they open. That information automatically appears on every other form in the deal that needs it. No re-typing. No copy-paste errors.

### 4. PDF Document Generation

Any completed form can be generated as a professional PDF document:

- **Data sheet mode** (active now) -- produces a clean, formatted summary PDF of all form data
- **Template overlay mode** (infrastructure built, ready for AREA PDF templates) -- will fill in the actual AREA PDF forms with exact field positioning once Diana provides the template files
- **Conveyancing package** -- generate a ZIP file containing all filled forms for a deal plus a document manifest

### 5. Electronic Signature Capture

Agents and clients can draw signatures directly on screen. Signatures are captured and embedded into generated PDF documents -- no printing, signing, and scanning required.

### 6. Notification System

In-app alerts keep agents and brokers informed:

- Deal status changes (e.g., a deal moves from Active to Firm)
- Forms reaching 100% completion
- Broker dashboard shows notifications across all active deals

### 7. Broker Dashboard

As broker/owner, you get an administrative view of all deals across the entire brokerage:

- See every active deal, who is working it, and its current status
- Monitor form completion progress
- Track deals from draft through closing
- Full visibility without needing to ask agents for updates

### 8. Office Location Management

The system supports multiple office locations. Each office has its own brokerage details (name, address, phone, fax) that automatically appear on documents generated for deals at that location. As Noralta grows, adding new offices is straightforward.

### 9. Bulk Pre-Fill at Deal Creation

When creating a new deal, agents can optionally enter buyer, seller, and property information upfront. This information immediately pre-fills across all applicable forms for that deal, so agents can start working with partially completed forms from the moment the deal is created.

### 10. Mobile-Friendly Design

The entire interface is built for mobile use:

- Collapsible form sections so agents are not overwhelmed on small screens
- Touch-optimized input fields
- Responsive layout that adapts to phones, tablets, and desktops
- Agents can work deals from the field, open houses, or client meetings

---

## How It Works -- The Agent Workflow

```
1. Agent logs in
      |
2. Sees their deal dashboard
      |
3. Creates a new deal
   - Selects transaction type (residential, commercial, lease)
   - Optionally pre-fills buyer/seller/property info
      |
4. System shows the applicable forms for that transaction type
      |
5. Agent opens and fills forms
   - Data entered once flows to all related forms automatically
   - Completion percentage tracks progress
      |
6. When forms are complete:
   - Generate PDFs
   - Collect signatures
   - Download or share documents
      |
7. Broker monitors all deals and receives milestone notifications
```

---

## Impact on the Brokerage

### Time Savings
Agents currently re-enter the same buyer name, address, and phone number on form after form. With the reuse engine, that information is entered **once** and flows to all 44 forms. On a typical residential transaction with 10-15 forms, this eliminates hundreds of redundant keystrokes per deal.

### Error Reduction
When data flows automatically between forms, there are no mismatched names, transposed phone numbers, or inconsistent addresses across documents. Every form in a deal shows the same information because it comes from one source.

### Compliance
FINTRAC forms -- often the most tedious part of compliance -- auto-populate property details, agent information, and party details from the deal. This reduces the compliance burden on agents and decreases the risk of incomplete filings.

### Mobility
Agents are not tied to a desktop computer. They can create deals, fill forms, and track progress from their phone while at a showing, an open house, or a client meeting.

### Brokerage-Wide Visibility
You see the real-time status of every deal across the brokerage. No more chasing agents for updates. No more wondering where a transaction stands. The broker dashboard gives you a complete picture at a glance.

### Scalability
The system supports multiple office locations with correct brokerage details on each document. As Noralta grows, the platform grows with it -- adding agents and offices requires no structural changes.

---

## Current Status

| Item | Status |
|------|--------|
| System deployment | Live and operational |
| Forms digitized | 44 forms |
| Fields mapped | 1,664+ |
| Reuse groups | 31 (eliminating duplicate data entry) |
| PDF generation | Working (data sheet mode) |
| Template overlay | Infrastructure built, awaiting AREA PDF files |
| Mobile interface | Optimized and responsive |
| Notification system | Active |
| Signature capture | Functional |
| Database | 36-table production schema, deployed |

---

## What Comes Next

1. **AREA PDF Templates** -- When Diana provides the actual AREA PDF files, the system will fill them in with exact field positioning on the official forms. The infrastructure to do this is already built and tested; it just needs the template files.

2. **Agent Onboarding** -- Add remaining agents and team members to the system. Each agent gets their own login, deal dashboard, and profile.

3. **Training** -- A brief walkthrough session for agents covering the workflow: creating deals, filling forms, using the reuse engine, and generating documents.

---

## Access

| | |
|---|---|
| **URL** | https://noralta-transaction-master.vercel.app |
| **Current User** | Diana McGee (dmcgee@royallepage.ca) |
| **New Accounts** | Can be created through the admin panel |

---

## Technical Summary (for reference)

The system is built on proven, modern web technology:

- **Frontend:** React + Tailwind CSS, hosted on Vercel (fast global CDN)
- **Backend:** Node.js + Express API, hosted on Railway
- **Database:** PostgreSQL with 36 tables covering transactions, parties, properties, agents, brokerages, lawyers, forms, documents, signatures, notifications, and more
- **Security:** Password hashing (bcrypt), session-based authentication with 24-hour expiry
- **Architecture:** RESTful API with dedicated routers for forms, documents, broker operations, notifications, and conditions

All data is stored in a secure, private database. The application and database communicate over a private network -- no data is exposed to the public internet.

---

*This system was purpose-built for Noralta Real Estate. It is not a generic off-the-shelf product -- every form, every field, and every workflow was designed around how your brokerage operates.*
