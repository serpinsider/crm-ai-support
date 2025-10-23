# Future Features Roadmap

## Phase 1: Lead Tracking & Unique Quote Links (Week 1-2)

### What It Does:
- Every pricing quote creates a lead/deal in HubSpot
- Customer gets personalized booking link pre-filled with their quote
- Track conversion from quote → link clicked → booking completed

### Implementation:
1. **When AI sends pricing:**
   - Create HubSpot contact (if new)
   - Create HubSpot deal with quote details
   - Generate unique quote code (e.g., Q-2024-001)
   - Create Quote record in database
   - Send custom link: `mesamaids.com/booking?q=ABC123`

2. **Booking page reads quote:**
   - Pre-fill form with bedrooms, bathrooms, service type, add-ons
   - Quote already calculated
   - Customer just adds: date, time, address, payment

3. **Track conversions:**
   - Deal stages: `quote_sent` → `link_clicked` → `form_started` → `payment_added` → `closedwon`

### Files to Create:
- `integrations/hubspot-integration.js` - HubSpot API wrapper
- `integrations/quote-manager.js` - Quote creation/tracking
- `mesa-maids/src/app/api/quote/[code]/route.ts` - Fetch quote by code
- Update booking page to read quote parameter

### Environment Variables:
```env
HUBSPOT_API_KEY=your_key
MESA_MAIDS_DATABASE_URL=your_postgres_url
```

---

## Phase 2: Customer Recognition (Week 2-3)

### What It Does:
- Recognize returning customers by phone number
- Personalize responses based on history
- Know if they're recurring, past customer, or have open quote

### Examples:
```
New customer: "How much for 2bd/1ba?"
Bot: "For 2bd/1ba standard it's $200..."

Returning customer: "How much for 2bd/1ba?"
Bot: "Hey John! For 2bd/1ba it's $200. Same as last time?"

Recurring customer: "Can I book?"
Bot: "Hey Sarah! Want to schedule your usual bi-weekly clean?"
```

### Implementation:
1. **Customer lookup on every message:**
   - Query Mesa Maids database by phone
   - Get: name, email, total bookings, last service, recurring status
   
2. **Pass context to AI:**
   - Include customer history in prompt
   - AI personalizes greeting and response
   
3. **Smart suggestions:**
   - If recurring: "Want your usual clean?"
   - If returning: "Same as last time?"
   - If has quote: "Still thinking about that deep clean?"

### Files to Create:
- `integrations/customer-lookup.js` - Database/HubSpot lookup
- Update `server.js` to call lookup before AI generation
- Update prompt builder to use customer context

### Database Queries:
```sql
-- Get customer by phone
SELECT 
  c.id, c.first_name, c.email, c.is_recurring,
  (SELECT service_type FROM bookings WHERE customer_id = c.id ORDER BY service_date DESC LIMIT 1) as last_service,
  (SELECT COUNT(*) FROM bookings WHERE customer_id = c.id) as total_bookings
FROM customers c
WHERE c.phone = $1
```

---

## Phase 3: Automated Follow-ups (Week 3-4)

### What It Does:
Automated SMS follow-ups based on customer behavior and booking status.

### A. Abandoned Quote Follow-up
**Trigger:** Quote sent, link not clicked after 2 hours
**Message:** 
```
"Hey, it's Sarah from Mesa Maids. Just wanted to follow up on that 2bd/1ba deep clean quote ($340). Still interested? Here's your link: mesamaids.com/booking?q=ABC123"
```

### B. Link Clicked But Not Booked
**Trigger:** Opened booking link but didn't complete within 24 hours
**Message:**
```
"Hey! I noticed you checked out the booking link but didn't finish. Any questions I can answer? Your quote is still good: mesamaids.com/booking?q=ABC123"
```

### C. Post-Clean Feedback Request
**Trigger:** Booking completed today, 6pm
**Message:**
```
"Hey [name]! Hope everything went well with today's cleaning. Would you mind leaving us a quick review? It really helps us out. mesamaids.com/review?b=123"
```

### D. Recurring Customer Reminder
**Trigger:** 3 days before next scheduled clean
**Message:**
```
"Hey [name]! Your bi-weekly clean is scheduled for Friday at 10am. See you then!"
```

### E. Win-back Inactive Customers
**Trigger:** Monthly, for customers 90+ days since last booking
**Message:**
```
"Hey [name]! It's been a while since your last clean. We'd love to help you out again. Want to schedule something?"
```

### Implementation:
1. **Cron jobs in Mesa Maids:**
   - `/api/cron/quote-followups` - Runs hourly
   - `/api/cron/post-clean-feedback` - Runs daily 6pm
   - `/api/cron/recurring-reminders` - Runs daily
   - `/api/cron/winback-campaign` - Runs monthly

2. **Vercel cron configuration:**
```json
{
  "crons": [
    {
      "path": "/api/cron/quote-followups",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/post-clean-feedback", 
      "schedule": "0 18 * * *"
    }
  ]
}
```

3. **Database tracking:**
   - Add fields: `followUpSent`, `feedbackRequested`, `lastContactDate`
   - Track all automated messages
   - Prevent duplicate follow-ups

### Files to Create:
- `mesa-maids/src/app/api/cron/quote-followups/route.ts`
- `mesa-maids/src/app/api/cron/post-clean-feedback/route.ts`
- `mesa-maids/src/app/api/cron/recurring-reminders/route.ts`
- `mesa-maids/src/app/api/cron/winback-campaign/route.ts`
- `integrations/followup-manager.js` - Shared follow-up logic

---

## Phase 4: Live Data Integration (Week 4-5)

### What It Does:
- Fetch live FAQ from Mesa Maids website
- Use real pricing calculator API
- Get actual service checklists
- Check real availability calendar

### Implementation:
1. **Create APIs on Mesa Maids:**
   - `/api/bot-quote` - Calculate exact quote
   - `/api/bot-faq` - Return FAQ data
   - `/api/bot-checklist/[type]` - Return service checklist
   - `/api/bot-availability` - Check calendar

2. **Bot calls APIs instead of static data:**
   - When customer asks price → Call quote API
   - When customer asks question → Check FAQ API
   - When customer asks "what's included" → Fetch checklist

3. **Benefits:**
   - Always accurate pricing
   - FAQ updates automatically propagate to bot
   - One source of truth

### Files to Create:
- `mesa-maids/src/app/api/bot-quote/route.ts`
- `mesa-maids/src/app/api/bot-faq/route.ts`
- `mesa-maids/src/app/api/bot-checklist/[type]/route.ts`
- Enable in `config/integration-settings.js`

---

## Phase 5: Direct Booking Creation (Week 5-6)

### What It Does:
Customer can complete entire booking via text message - no clicking links.

### Conversation Flow:
```
Customer: "Book me for Friday"
Bot: "Great! What time works? We have 9am, 12pm, or 3pm"
Customer: "9am"
Bot: "Perfect. What's your address?"
Customer: "[address]"
Bot: "And your email for confirmation?"
Customer: "[email]"
Bot: ✅ Creates booking
Bot: "All set! You're booked for Friday 9am at [address]. Confirmation sent to your email."
```

### Implementation:
1. **Multi-step conversation state:**
   - Track where customer is in booking flow
   - Store partial data (date, time, address, etc.)
   - Validate each step

2. **Booking creation API:**
   - Create booking in database
   - Create HubSpot deal (closedwon)
   - Send confirmation email/SMS
   - Add to calendar

3. **Error handling:**
   - Validate addresses
   - Check slot availability
   - Handle invalid dates/times
   - Allow customer to go back/restart

### Complexity:
- **High** - Requires state management across messages
- **Error-prone** - Many edge cases
- **User experience** - Customers might drop off mid-flow

### Recommendation:
Only build this if you see customers asking "can you just book me?" frequently. The quote link approach (Phase 1) is usually sufficient and simpler.

---

## Phase 6: Cold Outreach Campaign (Future)

### What It Does:
Automated cold outreach to businesses for commercial cleaning services.

### How It Works:
1. **Business Database:**
   - Upload list of target businesses (name, phone, industry, size)
   - Track: contacted, responded, converted, not interested
   
2. **Personalized Messages:**
   - AI generates personalized outreach based on business info
   - Different templates for: offices, restaurants, retail, medical, etc.
   - Mention specific business details (found online or provided)

3. **Drip Campaign:**
   - Initial message: "Hey [business name], we do commercial cleaning in [area]..."
   - Follow-up 1 (3 days): If no response
   - Follow-up 2 (1 week): Different angle
   - Mark as "not interested" after 3 attempts

4. **Conversation Handoff:**
   - If they respond interested → AI answers questions
   - When ready → Human takes over or AI books discovery call

### Example Messages:

**Initial:**
```
Hey [Business Name], 

We do commercial cleaning for offices in Mesa. Noticed you're on [Street Name]. 

Would you be interested in a quote for regular office cleaning? We work with businesses your size all the time.

Let me know if you'd like to hear more!
```

**Follow-up 1 (no response):**
```
Just following up from last week. We're offering 20% off for new commercial clients this month. 

Want a free quote for your office?
```

**If interested:**
```
Awesome! How many square feet is your office? And how often would you want service - daily, weekly, or bi-weekly?
```

### Implementation:

**Database Schema:**
```javascript
{
  businessName: "ABC Law Firm",
  phone: "+14805551234",
  address: "123 Main St, Mesa",
  industry: "Office/Legal",
  squareFeet: "2000",
  employees: "10-20",
  status: "not_contacted",
  contactedAt: null,
  respondedAt: null,
  interestedStatus: null,
  notes: ""
}
```

**Campaign Manager:**
```javascript
// Send initial outreach batch (50-100/day max)
async function sendOutreachBatch() {
  const businesses = await getUncontactedBusinesses(50);
  
  for (const business of businesses) {
    const message = generatePersonalizedOutreach(business);
    await sendSMS(business.phone, message);
    await markAsContacted(business.id);
    
    // Delay between sends to avoid spam detection
    await sleep(2000);
  }
}

// Check for responses and follow up
async function handleOutreachResponses() {
  const responses = await getOutreachResponses();
  
  for (const response of responses) {
    if (response.interested) {
      // AI engages with questions
      await handleCommercialInquiry(response);
    } else if (response.notInterested) {
      // Mark as DNC
      await markAsNotInterested(response.businessId);
    }
  }
}

// Follow-up campaign
async function sendFollowUps() {
  // After 3 days, no response
  const needsFollowUp = await getBusinessesForFollowUp();
  
  for (const business of needsFollowUp) {
    const followUpMessage = generateFollowUpMessage(business);
    await sendSMS(business.phone, followUpMessage);
    await updateFollowUpCount(business.id);
  }
}
```

### Files to Create:
- `integrations/cold-outreach-manager.js` - Campaign logic
- `mesa-maids/src/app/api/outreach/businesses/route.ts` - Manage business list
- `mesa-maids/src/app/api/outreach/send-batch/route.ts` - Send outreach batch
- `mesa-maids/src/app/api/cron/outreach-followups/route.ts` - Automated follow-ups
- Database table: `outreach_businesses`

### Admin Interface:
- Upload business list (CSV)
- View campaign stats (sent, responded, interested, converted)
- Manually mark businesses as DNC or interested
- Review conversations
- Adjust templates

### Compliance & Safety:
- Respect Do Not Contact (DNC) list
- Max sends per day (avoid spam flags)
- Unsubscribe option: "Reply STOP to opt out"
- Only send during business hours
- Track opt-outs immediately

### Metrics to Track:
- Messages sent
- Response rate
- Interest rate
- Conversion to quote/booking
- Cost per acquisition
- ROI per campaign

### Estimated Results:
- 100 businesses contacted
- 20% response rate = 20 responses
- 50% of responses interested = 10 leads
- 30% of leads convert = 3 new commercial clients
- Average commercial contract: $500-2000/month
- Monthly recurring revenue: $1500-6000

---

## Phase 7: Multi-Location Support (Future)

### What It Does:
Same bot handles Brooklyn Maids, Mesa Maids, STL Maids - detects which number they texted.

### Implementation:
1. **Detect business from phone number:**
```javascript
const businessConfig = {
  '+14805200202': 'mesa-maids',
  '+13477504380': 'brooklyn-maids', 
  '+13143100970': 'stl-maids'
};

const business = businessConfig[messageData.to];
```

2. **Load appropriate config:**
```javascript
import { buildSystemPrompt } from `./config/${business}/prompt-builder.js`;
import { BUSINESS_INFO } from `./config/${business}/knowledge.js`;
```

3. **Separate configs per business:**
```
config/
├── mesa-maids/
│   ├── knowledge.js
│   └── personality.js
├── brooklyn-maids/
│   ├── knowledge.js
│   └── personality.js
└── stl-maids/
    ├── knowledge.js
    └── personality.js
```

---

## Implementation Priority

### Must Have (Before Launch):
1. ✅ Natural conversational tone
2. ✅ Conversation memory
3. ✅ Accurate pricing
4. ✅ FAQ usage

### High Priority (First Month):
1. Lead tracking (Phase 1)
2. Unique quote links (Phase 1)
3. Customer recognition (Phase 2)

### Medium Priority (Month 2):
1. Abandoned quote follow-ups (Phase 3)
2. Post-clean feedback (Phase 3)
3. Live data integration (Phase 4)

### Low Priority (Month 3+):
1. Recurring reminders (Phase 3)
2. Win-back campaigns (Phase 3)
3. Direct booking creation (Phase 5)
4. Multi-location support (Phase 6)

---

## Metrics to Track

### Conversion Funnel:
- Conversations started
- Quotes sent
- Links clicked
- Forms started
- Bookings completed
- Conversion rate at each stage

### Bot Performance:
- Average response time
- Questions answered automatically
- Escalations to human
- Customer satisfaction (ask for rating)

### ROI:
- Leads generated
- Bookings from bot
- Revenue attributed to bot
- Time saved (vs manual responses)
- After-hours conversions (bot never sleeps)

---

## Estimated Timeline

- **Phase 1:** 1-2 weeks
- **Phase 2:** 1 week
- **Phase 3:** 1-2 weeks
- **Phase 4:** 1 week
- **Phase 5:** 2 weeks
- **Total:** 6-8 weeks for everything

## Estimated Costs

- Development: Already built (just needs integration)
- OpenPhone: ~$20/mo (you already have)
- Claude API: ~$10-30/mo (depends on volume)
- Hosting (Render): $7/mo or free
- **Total new costs:** ~$15-55/mo

## Expected ROI

Conservative estimate:
- 50 conversations/month
- 20% conversion rate = 10 bookings
- Average booking: $250
- Revenue: $2,500/mo
- Cost: $50/mo
- **ROI: 50x**

Plus:
- 24/7 availability
- Instant responses
- Consistent quality
- Time saved for your team

