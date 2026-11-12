import React from "react";
import { BookOpen } from "lucide-react";

/**
 * HRM → Leave → "Leave policy": the company's written leave policy, so anyone
 * can read it where they apply. Text as given by HR (Nov 2026), with ONE
 * deliberate change agreed with the founders: 5 days' notice for casual leave
 * is recommended, not mandatory (hr_leave_core.py flags short notice for the
 * manager instead of refusing it). Keep this in step with hr_leave_core.py —
 * the server applies the rules; this page only explains them.
 */
const TYPES = [
    ["Casual leave (CL)", "6 days per year"],
    ["Sick leave (SL)", "6 days per year"],
    ["Earned leave (EL)", "6 days per year (½ day per completed month)"],
    ["Maternity leave", "As per Government rules"],
    ["Paternity leave", "5 days (per child, around the birth)"],
    ["Optional holiday", "1 day per year, from the company's optional holiday list"],
];

function Sec({ title, children, open = false }) {
    return (
        <details open={open} className="group border border-[#E5E7EB] bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between font-medium text-[#002B5C]">
                {title}<span className="text-[#6B7280] text-xs group-open:rotate-180 transition-transform" aria-hidden="true">▼</span>
            </summary>
            <div className="px-4 pb-4 text-sm text-[#374151] leading-relaxed space-y-2">{children}</div>
        </details>
    );
}

const Ul = ({ items }) => <ul className="list-disc pl-5 space-y-1">{items.map((t) => <li key={t}>{t}</li>)}</ul>;

export default function LeavePolicy() {
    return (
        <div className="space-y-3" data-testid="hrm-leave-policy">
            <div className="bg-white border border-[#E5E7EB] p-5">
                <h2 className="font-serif text-2xl text-[#002B5C] flex items-center gap-2"><BookOpen size={22} aria-hidden="true" />Leave policy</h2>
                <p className="mt-2 text-sm text-[#374151] leading-relaxed">
                    OakBridge Publishing believes that people need free time to balance their personal and professional lives. A good
                    work-life balance keeps you rested and motivated at work. We encourage everyone to maintain that balance and to keep
                    giving their best — both at work and in their personal space.
                </p>
                <p className="mt-2 text-sm text-[#374151]">All leave is guided by this policy, which stays in force until further notice.</p>
                <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
                    <div className="bg-[#F5F7FA] px-3 py-2"><b className="text-[#002B5C]">Leave year:</b> 1 April – 31 March</div>
                    <div className="bg-[#F5F7FA] px-3 py-2"><b className="text-[#002B5C]">Who:</b> confirmed employees (see each type for exceptions)</div>
                </div>
            </div>

            <Sec title="Types of leave" open>
                <table className="w-full text-sm">
                    <tbody>{TYPES.map(([t, d]) => <tr key={t} className="border-t border-[#F3F4F6]"><td className="py-1.5 pr-3 font-medium">{t}</td><td className="py-1.5">{d}</td></tr>)}</tbody>
                </table>
            </Sec>

            <Sec title="Casual leave (CL)">
                <Ul items={[
                    "Please apply at least 5 days in advance — this is recommended so your team can plan.",
                    "Shorter notice is allowed; your manager will see that it was short notice when approving.",
                    "CL cannot be carried forward to the next year.",
                ]} />
            </Sec>

            <Sec title="Sick leave (SL)">
                <Ul items={[
                    "Advance notice isn't required if it isn't possible to give it.",
                    "Inform your manager at the earliest opportunity — no later than the close of business hours on the first day of absence. Otherwise it is treated as an absence.",
                    "Record the sick leave in the HRM as soon as you're back in the office.",
                    "More than 3 days at a stretch needs a medical certificate.",
                    "SL cannot be carried forward to the next year.",
                ]} />
            </Sec>

            <Sec title="Earned leave (EL)">
                <Ul items={[
                    "Earned at 0.5 day for every completed month — 6 days a year.",
                    "New employees start earning EL once they are confirmed.",
                    "Unused EL can be carried over to the next year, up to a maximum of 12 days.",
                    "EL encashment is done at the rate of basic salary when leaving the company or on retirement, provided you have completed at least 1 year of service after confirmation.",
                ]} />
            </Sec>

            <Sec title="Maternity leave">
                <Ul items={[
                    "For permanent women employees who have worked at least 180 days in the organisation in the 12 months immediately before the expected date of delivery.",
                    "Available for a maximum of 2 children.",
                    "Holidays and weekends in between are included in the leave.",
                    "Apply to your manager at least one month in advance.",
                    "Extension of leave is not allowed.",
                ]} />
            </Sec>

            <Sec title="Paternity leave">
                <Ul items={[
                    "5 days, taken together or split, within 15 days of the child's birth.",
                    "Available for two children only.",
                ]} />
            </Sec>

            <Sec title="Compensatory off (comp-off)">
                <Ul items={[
                    "If you work on a company holiday or your weekly off with prior approval, you can apply for a comp-off.",
                    "Use it within two months of the day you worked.",
                ]} />
            </Sec>

            <Sec title="Loss of pay and unauthorised leave">
                <Ul items={[
                    "Any leave that isn't approved is treated as loss of pay (LOP).",
                    "For LOP, holidays and weekends in between are counted.",
                    "Leave taken without approval is unauthorised leave.",
                    "Being absent without informing anyone — or staying away for 1 week or more after your approved leave ends — is treated as having left the company.",
                ]} />
            </Sec>

            <Sec title="General">
                <Ul items={[
                    "The leave year is the financial year: 1 April to 31 March.",
                    "Leave can be taken only when you have enough balance.",
                    "Apply to your reporting manager. Applying here in the HRM emails your manager automatically and keeps your balance up to date — no separate email needed.",
                ]} />
            </Sec>
            <p className="text-xs text-[#6B7280] px-1">Questions about the policy? Please speak to HR.</p>
        </div>
    );
}
