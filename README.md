# Mufti Laundry — Web Application & Order Management System

> A full-stack web application designed to streamline laundry and dry-cleaning service management. The platform allows customers to schedule home pickups, select custom treatment options, track order progress in real time, and manage payments, while providing business administrators with a centralized dashboard to process orders and track service workflows.
---

## Overview

Traditional laundry and dry-cleaning services suffer from operational bottlenecks that disrupt service delivery and lower customer trust:

* **Opaque Order Statuses:** Customers constantly call or visit branches to check if items are ready.
* **Manual Tagging & Paper Receipts:** Garments are prone to loss due to handwritten tags and physical receipts.
* **Fragmented Billing:** Cash handling, partial payments, and invoice tracking are difficult to audit across multiple locations.
* **Administrative Blindspots:** Management lacks real-time visibility into active workloads, pending orders, and daily branch revenue.

**Mufti Laundry** solves these friction points by uniting customer bookings, staff workflow controls, printable tags, automated receipts, and analytical dashboards into a single application.

---

## User & Operational Workflow

```text
[Customer Booking / Drop-off]
       ↓
[Order Creation & Tagging (Staff Dashboard)]
       ↓
[Printable Garment Tags & Digital Receipt Generated]
       ↓
[Status Lifecycle: Received → In-Wash → Ironing → Ready]
       ↓
[Real-Time Customer Order Tracking (Unique Order Code)]
       ↓
[Billing Verification & Final Pickup / Delivery]

```

---

## Key Features

### Customer Experience

* **Online Booking Engine:** Interactive service selector, pricing breakdown, and location-based booking.
* **Real-Time Order Tracking:** Public tracking view (`/track-order`) allowing customers to monitor garment status using a unique reference code.
* **Direct Communication Channels:** Floating WhatsApp integration and branch location directory for quick customer support.
* **Interactive Pricing Calculator:** Live calculation of costs across dry cleaning, washing, folding, and ironing.

### Staff & Operations

* **Centralized Staff Portal:** Role-based workspace (`/staff-dashboard`) tailored for daily laundry processing and garment tracking.
* **Modal-Driven Workflows:** Instant creation of new orders, billing modals, and payment reconciliation interfaces.
* **Printable Garment Tags:** Auto-formatted layout for generating physical tags to prevent lost or mixed items.
* **Status Management Engine:** Quick-action toggles to advance orders through cleaning stages (*Received*, *In Progress*, *Ready*, *Delivered*).

### Administration & Analytics

* **Executive Overview Dashboard:** Centralized metrics displaying active orders, total revenue, pending balances, and operational efficiency.
* **Staff Management & Auditing:** Administrative controls to onboard staff members, manage roles, and review branch performance.
* **Invoice & Receipt System:** Complete invoice view (`/invoice`) with breakdown of itemized charges, payments made, and outstanding balances.

---

## Tech Stack

### Client & Interface

* **Framework:** React 18
* **Build Tool:** Vite
* **Styling & UI:** Tailwind CSS, Custom Glassmorphism Modals, Lucide Icons
* **State & Routing:** React Router v6, React Context API (`AuthContext`)
* **HTTP Client:** Axios (configured with custom interceptors for base endpoints)

### Infrastructure & Deployment

* **Deployment Platform:** Vercel (`vercel.json` configured for SPA route rewrites)
* **Code Quality & Tooling:** ESLint 9 (Flat Config standard)

---

## Application Architecture

```text
┌──────────────────────────────────────────────────────────┐
│                      Client Layer                        │
│                                                          │
│   Landing Page & Booking   │   Order Tracking View       │
│   Staff Dashboard          │   Admin Overview & Audits   │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                    Application State                     │
│                                                          │
│   Auth Context (JWT/Session)  │  API Layer (Axios)       │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                    Operations Engine                     │
│                                                          │
│   Status Modals  │  Printable Tag Generator │ Invoice    │
└──────────────────────────────────────────────────────────┘

```

---

## Project Structure

```text
mufti-laundry-website/
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── api/
│   │   └── axios.js               # Global Axios instance with interceptors
│   ├── assets/                    # Static images, hero banners, and vector assets
│   ├── components/
│   │   ├── AdminLayout.jsx        # Wrapper with navigation for admin pages
│   │   ├── BillingModal.jsx       # Modal for processing client balances
│   │   ├── CreateOrderModal.jsx   # Form modal for logging new laundry batches
│   │   ├── PaymentModal.jsx       # Payment recording and verification
│   │   ├── PrintableTag.jsx       # Physical garment tag template for printing
│   │   ├── Receipt.jsx            # Dynamic customer receipt view
│   │   ├── StatusUpdateModal.jsx  # Stage tracking controller
│   │   └── protectedRoute.jsx     # Route guard enforcing authentication
│   ├── context/
│   │   └── AuthContext.jsx        # Auth state management & token persistence
│   ├── muftiLandingpage/          # Public-facing brand presentation & booking UI
│   │   ├── components/            # Hero, Booking, Services, Pricing, SEO Head
│   │   ├── data/                  # Service catalogs, branch lists, testimonials
│   │   ├── hooks/                 # Custom scroll and counter hooks
│   │   └── utils/                 # Helper utilities
│   ├── pages/
│   │   ├── DashboardOverview.jsx  # Primary executive analytics dashboard
│   │   ├── InvoiceView.jsx        # Itemized invoice document view
│   │   ├── Login.jsx              # Secured staff/admin authentication portal
│   │   ├── Orders.jsx             # Comprehensive order index and management
│   │   ├── Services.jsx           # Service catalog and rate administration
│   │   ├── StaffDashboard.jsx     # Daily operational workspace for laundry staff
│   │   ├── StaffManagement.jsx    # System admin employee portal
│   │   └── TrackOrder.jsx         # Public customer order lookup
│   ├── App.jsx                    # Application routes and main layout router
│   ├── main.jsx                   # React application entry point
│   └── index.css                  # Tailwind directives and custom utility styles
├── .env.example                   # Environment variable blueprint
├── DEPLOYMENT_GUIDE.md            # Step-by-step production deployment guide
├── eslint.config.js               # ESLint configuration
├── package.json                   # Project scripts and dependencies
├── vercel.json                    # Single-Page Application rewrite rules for Vercel
└── vite.config.js                 # Vite bundler configuration

```

---

## Getting Started

### Prerequisites

* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher

### Installation & Setup

1. **Clone the Repository**
```bash
git clone [https://github.com/GodWithUs17/mufti-laundry-website.git](https://github.com/GodWithUs17/mufti-laundry-website.git)
cd mufti-laundry-website

```


2. **Install Dependencies**
```bash
npm install

```


3. **Configure Environment Variables**
Create a local `.env` file from the example blueprint:
```bash
cp .env.example .env

```


Set your API endpoint inside `.env`:
```env
VITE_API_BASE_URL=http://localhost:5000/api

```


4. **Run Local Development Server**
```bash
npm run dev

```


Open `http://localhost:5173` in your browser.

---

## Available Scripts

* `npm run dev`: Boots the Vite development server with Hot Module Replacement (HMR).
* `npm run build`: Compiles minified HTML, CSS, and JS production bundles to `/dist`.
* `npm run preview`: Previews the production build locally.
* `npm run lint`: Scans source code for potential errors using ESLint.

---

## Engineering Highlights

* **Dynamic Tag & Receipt Rendering:** Constructed specialized print-friendly DOM components (`PrintableTag.jsx`, `Receipt.jsx`) using pure CSS `@media print` rules, eliminating external heavy PDF dependencies.
* **SPA Routing Resilience:** Configured a dedicated `vercel.json` file with fallback rewrites to ensure deep routes like `/track-order` and `/invoice` resolve cleanly without 404 errors on server reloads.
* **Modular Component Isolation:** Separated the marketing/booking engine (`/muftiLandingpage`) from internal operations (`/pages`, `/components`) to enforce strict boundaries between public interactions and secure business logic.

---

## Author

**Oguntoke Emmanuel Omotayo**

Full-Stack Web Developer focused on building practical, high-converting, and scalable web applications.

* **GitHub:** [@GodWithUs17](https://www.google.com/search?q=https://github.com/GodWithUs17)
* **LinkedIn:** [oguntoke-emmanuel](https://www.google.com/search?q=https://linkedin.com/in/oguntoke-emmanuel)

```

```
