// ============================================================
// CTRLpanel — mock/placeholder data
// Used until real Supabase / API connections are wired (AGENTS.md rule #8).
// ============================================================

function dayOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const dashboardStats = {
  netWorth: 184250,
  netWorthChange: 2.4,
  openTasks: 12,
  caloriesToday: 1840,
  caloriesGoal: 2400,
  activeAgents: 2,
  totalAgents: 3,
};

export const mockEvents = [
  { id: 'e1', time: '9:00 AM', title: 'Standup — ViridianAI', color: '#e11d48', meta: 'Google Meet' },
  { id: 'e2', time: '1:30 PM', title: 'Client call — Web design proposal', color: '#3b82f6', meta: '45 min' },
  { id: 'e3', time: '4:00 PM', title: 'Gym — Push day', color: '#10b981', meta: 'PureGym' },
];

export const mockPriorityTasks = [
  { id: 't1', title: 'Finish ViridianAI landing page', priority: 'High', due: dayOffset(0), project: 'ViridianAI' },
  { id: 't2', title: 'Send CTRLpanel demo to investor', priority: 'Urgent', due: dayOffset(1), project: 'CTRLpanel' },
  { id: 't3', title: 'Record ContentFactory walkthrough', priority: 'Medium', due: dayOffset(2), project: 'ContentFactory' },
];

export const mockAgents = [
  { id: 'a1', name: 'Outreach Agent', description: 'Cold email + LinkedIn outreach', webhook_url: 'https://hooks.example.com/outreach', status: 'running', last_run: '2026-06-15T08:12:00Z' },
  { id: 'a2', name: 'Financial Agent', description: 'Tracks expenses & flags anomalies', webhook_url: 'https://hooks.example.com/financial', status: 'running', last_run: '2026-06-15T06:00:00Z' },
  { id: 'a3', name: 'Social Media Agent', description: 'Schedules + posts content', webhook_url: 'https://hooks.example.com/social', status: 'stopped', last_run: '2026-06-14T19:30:00Z' },
];

export const KANBAN_COLUMNS = ['Backlog', 'In Progress', 'Review', 'Done'];

export const mockBoards = [
  { id: 'b-global', name: 'Global' },
  { id: 'b-viridian', name: 'ViridianAI' },
  { id: 'b-ctrl', name: 'CTRLpanel' },
];

export const mockTasks = [
  { id: 't1', board_id: 'b-viridian', title: 'Finish ViridianAI landing page', description: 'Hero + pricing section', column_name: 'In Progress', priority: 'High', due_date: dayOffset(0), project_id: 'ViridianAI', labels: ['design'] },
  { id: 't2', board_id: 'b-ctrl', title: 'Send CTRLpanel demo to investor', description: 'Record 5 min Loom', column_name: 'Backlog', priority: 'Urgent', due_date: dayOffset(1), project_id: 'CTRLpanel', labels: ['sales'] },
  { id: 't3', board_id: 'b-global', title: 'Record ContentFactory walkthrough', description: '', column_name: 'Backlog', priority: 'Medium', due_date: dayOffset(2), project_id: 'ContentFactory', labels: [] },
  { id: 't4', board_id: 'b-ctrl', title: 'Fix CRM CSV import bug', description: 'Column mapping edge case', column_name: 'Review', priority: 'High', due_date: dayOffset(-1), project_id: 'CTRLpanel', labels: ['bug'] },
  { id: 't5', board_id: 'b-global', title: 'Onboard new VA', description: '', column_name: 'Done', priority: 'Low', due_date: dayOffset(-3), project_id: 'Global', labels: [] },
  { id: 't6', board_id: 'b-viridian', title: 'Set up analytics', description: 'PostHog + funnels', column_name: 'Backlog', priority: 'Medium', due_date: dayOffset(4), project_id: 'ViridianAI', labels: ['eng'] },
  { id: 't7', board_id: 'b-ctrl', title: 'Wire Supabase auth', description: '', column_name: 'In Progress', priority: 'High', due_date: dayOffset(3), project_id: 'CTRLpanel', labels: ['eng'] },
];

export const mockProjects = [
  { id: 'p1', name: 'ViridianAI', status: 'Active', color: '#10b981', description: 'AI consulting agency site + product.', goal: 'Launch MVP by Q3', notes: '## ViridianAI\n\n- Brand: green, modern\n- Target: SMB owners\n', files: [{ title: 'Brand kit', url: 'https://example.com/brand' }] },
  { id: 'p2', name: 'CTRLpanel', status: 'Active', color: '#e11d48', description: 'Personal Life OS.', goal: 'Ship v1 personal Life OS', notes: '## CTRLpanel\n\nBuild order in AGENTS.md.', files: [] },
  { id: 'p3', name: 'ContentFactory', status: 'Paused', color: '#f59e0b', description: 'Automated content pipeline.', goal: 'Automate content pipeline', notes: '', files: [] },
];

export const SERVICE_OPTIONS = ['Web Design', 'AI Receptionist', 'SEO', 'Social Media Management', 'Automation', 'Consulting', 'Other'];
export const LEAD_TEMPS = ['Cold', 'Warm', 'Hot'];

export const mockContacts = [
  { id: 'c1', business_name: 'Sunrise Dental', phone: '(555) 201-3345', email: 'hello@sunrisedental.com', business_type: 'Healthcare', service: 'Web Design', lead_temp: 'Hot', rating: 4.6, total_reviews: 128, opening_hours: '8–5 M–F', search_location: 'Austin, TX', times_called: 2, last_touch: dayOffset(-1), left_voicemail: true, notes: 'Wants new site by August' },
  { id: 'c2', business_name: 'Peak Fitness', phone: '(555) 884-1100', email: 'info@peakfit.io', business_type: 'Fitness', service: 'SEO', lead_temp: 'Warm', rating: 4.2, total_reviews: 64, opening_hours: '5–10 daily', search_location: 'Denver, CO', times_called: 1, last_touch: dayOffset(-4), left_voicemail: false, notes: '' },
  { id: 'c3', business_name: 'Harbor Law Group', phone: '(555) 332-9087', email: 'contact@harborlaw.com', business_type: 'Legal', service: 'AI Receptionist', lead_temp: 'Cold', rating: 4.9, total_reviews: 210, opening_hours: '9–6 M–F', search_location: 'Seattle, WA', times_called: 0, last_touch: null, left_voicemail: false, notes: 'Referral from Sunrise' },
  { id: 'c4', business_name: 'Bloom Florals', phone: '(555) 778-2210', email: 'orders@bloomflorals.com', business_type: 'Retail', service: 'Social Media Management', lead_temp: 'Warm', rating: 4.7, total_reviews: 89, opening_hours: '9–7 daily', search_location: 'Portland, OR', times_called: 3, last_touch: dayOffset(-2), left_voicemail: true, notes: 'Loves IG reels' },
];

export const mockMacros = {
  calories: { current: 1840, goal: 2400 },
  protein: { current: 142, goal: 180 },
  carbs: { current: 190, goal: 250 },
  fat: { current: 61, goal: 80 },
};

export const mockMicros = [
  { name: 'Vitamin D', value: 82 },
  { name: 'B12', value: 110 },
  { name: 'Vitamin C', value: 65 },
  { name: 'Iron', value: 48 },
  { name: 'Zinc', value: 90 },
  { name: 'Magnesium', value: 72 },
  { name: 'Omega-3', value: 55 },
  { name: 'Potassium', value: 38 },
];

export const mockMeals = [
  { id: 'm1', time: '7:30 AM', meal_name: 'Greek yogurt + berries', calories: 320, protein: 28, carbs: 34, fat: 9 },
  { id: 'm2', time: '12:15 PM', meal_name: 'Chicken & rice bowl', calories: 640, protein: 52, carbs: 70, fat: 16 },
  { id: 'm3', time: '3:00 PM', meal_name: 'Protein shake', calories: 220, protein: 40, carbs: 8, fat: 3 },
  { id: 'm4', time: '7:00 PM', meal_name: 'Salmon + veg', calories: 660, protein: 42, carbs: 38, fat: 33 },
];

// 14 days of nutrition + weight history (for the Recharts line chart)
export const mockNutritionHistory = Array.from({ length: 14 }).map((_, i) => {
  const day = 13 - i;
  return {
    date: dayOffset(-day),
    calories: 2000 + Math.round(Math.sin(i) * 250) + (i % 3) * 60,
    protein: 150 + Math.round(Math.cos(i) * 20),
    carbs: 210 + Math.round(Math.sin(i / 2) * 40),
    fat: 70 + Math.round(Math.cos(i / 2) * 10),
    weight: 184 - i * 0.15,
  };
});

export const SUPPLEMENT_TIMINGS = ['Morning', 'Afternoon', 'Evening', 'Night'];

export const mockSupplements = [
  { id: 's1', name: 'Vitamin D3', dose: '5000 IU', timing: 'Morning', enabled: true, units_remaining: 42, streak: 12 },
  { id: 's2', name: 'Omega-3', dose: '2g', timing: 'Morning', enabled: true, units_remaining: 5, streak: 8 },
  { id: 's3', name: 'Magnesium Glycinate', dose: '400mg', timing: 'Night', enabled: true, units_remaining: 30, streak: 21 },
  { id: 's4', name: 'Creatine', dose: '5g', timing: 'Afternoon', enabled: true, units_remaining: 60, streak: 40 },
  { id: 's5', name: 'Ashwagandha', dose: '600mg', timing: 'Evening', enabled: false, units_remaining: 18, streak: 0 },
];

export const WORKOUT_TYPES = ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Cardio', 'Rest', 'Custom'];
export const WORKOUT_COLORS = {
  Push: '#e11d48',
  Pull: '#3b82f6',
  Legs: '#10b981',
  Upper: '#8b5cf6',
  Lower: '#f59e0b',
  Cardio: '#14b8a6',
  Rest: '#3d2e2e',
  Custom: '#ec4899',
};
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const mockSchedule = {
  Mon: 'Push',
  Tue: 'Pull',
  Wed: 'Legs',
  Thu: 'Cardio',
  Fri: 'Upper',
  Sat: 'Lower',
  Sun: 'Rest',
};

// 52 weeks * 7 days of workout volume for the heatmap (0 = rest)
export const mockHeatmap = Array.from({ length: 52 * 7 }).map((_, i) => {
  const r = Math.sin(i * 1.3) + Math.cos(i / 5);
  const v = r > 0.6 ? 3 : r > 0.1 ? 2 : r > -0.4 ? 1 : 0;
  return v;
});

export const mockAccounts = [
  { id: 'ac1', name: 'Chase Checking', type: 'Checking', balance: 12400, updated_at: '2026-06-15' },
  { id: 'ac2', name: 'Ally Savings', type: 'Savings', balance: 48200, updated_at: '2026-06-14' },
  { id: 'ac3', name: 'Brokerage', type: 'Investment', balance: 96100, updated_at: '2026-06-15' },
  { id: 'ac4', name: 'Crypto Wallet', type: 'Crypto', balance: 23520, updated_at: '2026-06-15' },
  { id: 'ac5', name: 'Tesla Model 3', type: 'Vehicle', balance: 31000, updated_at: '2026-06-01' },
  { id: 'ac6', name: 'Car Loan', type: 'Liability', balance: 8970, updated_at: '2026-06-10' },
  { id: 'ac7', name: 'Credit Card', type: 'Liability', balance: 2100, updated_at: '2026-06-15' },
];

export const ACCOUNT_TYPES = ['Checking', 'Savings', 'Investment', 'Crypto', 'Real Estate', 'Vehicle', 'Liability'];
export const LIABILITY_TYPES = ['Liability'];

export const mockNetWorthHistory = Array.from({ length: 12 }).map((_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() - (11 - i));
  return { date: d.toLocaleDateString('en-US', { month: 'short' }), total: 150000 + i * 3200 + Math.round(Math.sin(i) * 4000) };
});

export const mockIncome = [
  { id: 'i1', name: 'ViridianAI retainer', amount: 6000, frequency: 'Monthly', type: 'Business' },
  { id: 'i2', name: 'Freelance', amount: 2200, frequency: 'Monthly', type: 'Business' },
  { id: 'i3', name: 'Dividends', amount: 180, frequency: 'Monthly', type: 'Investment' },
];

export const mockExpenseCategories = [
  { id: 'ec1', name: 'Rent', type: 'Fixed', budgeted: 2200, spent: 2200 },
  { id: 'ec2', name: 'Groceries', type: 'Variable', budgeted: 600, spent: 410 },
  { id: 'ec3', name: 'Dining', type: 'Variable', budgeted: 400, spent: 380 },
  { id: 'ec4', name: 'Software', type: 'Fixed', budgeted: 300, spent: 290 },
  { id: 'ec5', name: 'Transport', type: 'Variable', budgeted: 250, spent: 130 },
  { id: 'ec6', name: 'Health', type: 'Variable', budgeted: 200, spent: 95 },
];

export const mockTransactions = [
  { id: 'tx1', date: dayOffset(-1), amount: 45, category_id: 'ec3', note: 'Uber Eats', recurring: false },
  { id: 'tx2', date: dayOffset(-2), amount: 82, category_id: 'ec2', note: 'Whole Foods', recurring: false },
  { id: 'tx3', date: dayOffset(-3), amount: 20, category_id: 'ec4', note: 'Figma', recurring: true },
  { id: 'tx4', date: dayOffset(-5), amount: 60, category_id: 'ec5', note: 'Gas', recurring: false },
];

export const mockHoldings = [
  { id: 'h1', ticker: 'AAPL', name: 'Apple Inc.', asset_class: 'Stocks', shares: 25, avg_cost: 165.4, manual_price: 212.1 },
  { id: 'h2', ticker: 'VTI', name: 'Vanguard Total Market', asset_class: 'ETFs', shares: 40, avg_cost: 220.0, manual_price: 268.9 },
  { id: 'h3', ticker: 'BTC', name: 'Bitcoin', asset_class: 'Crypto', shares: 0.35, avg_cost: 41000, manual_price: 67200 },
  { id: 'h4', ticker: 'MSFT', name: 'Microsoft', asset_class: 'Stocks', shares: 15, avg_cost: 310.0, manual_price: 442.5 },
  { id: 'h5', ticker: 'ETH', name: 'Ethereum', asset_class: 'Crypto', shares: 3.2, avg_cost: 2200, manual_price: 3450 },
];

export const mockDividends = [
  { id: 'd1', holding: 'AAPL', amount: 24.5, paid_date: dayOffset(-12), yield: 0.5 },
  { id: 'd2', holding: 'VTI', amount: 96.2, paid_date: dayOffset(-30), yield: 1.4 },
  { id: 'd3', holding: 'MSFT', amount: 18.0, paid_date: dayOffset(-20), yield: 0.7 },
];

export const mockPortfolioHistory = Array.from({ length: 12 }).map((_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() - (11 - i));
  return { date: d.toLocaleDateString('en-US', { month: 'short' }), value: 70000 + i * 2400 + Math.round(Math.cos(i) * 3000) };
});
