import { useState } from "react";
import { Calendar, Clock, ListOrdered } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReviewSlot } from "@/lib/page-scope";

const TIME_OPTIONS = [
  [0, "শুধু দিনের ব্যবধান"], [5, "5 মিনিট"], [10, "10 মিনিট"], [15, "15 মিনিট"],
  [30, "30 মিনিট"], [60, "1 ঘণ্টা"], [120, "2 ঘণ্টা"], [180, "3 ঘণ্টা"],
  [300, "5 ঘণ্টা"], [360, "6 ঘণ্টা"], [720, "12 ঘণ্টা"], [1440, "24 ঘণ্টা"],
] as const;

export function ReviewIntervals({ start, count, onApply }: {
  start: ReviewSlot;
  count: number;
  onApply: (start: ReviewSlot, minutes: number, days: number) => void;
}) {
  const [date, setDate] = useState(start.d);
  const [time, setTime] = useState(start.t);
  const [minutes, setMinutes] = useState("120");
  const [days, setDays] = useState("0");
  const [customMinutes, setCustomMinutes] = useState("5");
  const [customDays, setCustomDays] = useState("1");
  const selectClass = "h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm";

  return (
    <div className="space-y-3 border-y py-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><ListOrdered className="h-4 w-4 text-primary" />রিভিউ পোস্টের তারিখ ও সময়ের ব্যবধান <span className="font-normal text-muted-foreground">· {count} পোস্ট</span></h3>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 space-y-1.5">
          <label htmlFor="review-start-date" className="flex items-center gap-1.5 text-xs font-medium"><Calendar className="h-3.5 w-3.5" />শুরুর তারিখ</label>
          <Input id="review-start-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-w-0" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <label htmlFor="review-start-time" className="flex items-center gap-1.5 text-xs font-medium"><Clock className="h-3.5 w-3.5" />শুরুর সময় (ঢাকা)</label>
          <Input id="review-start-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="min-w-0" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <label htmlFor="review-minute-gap" className="text-xs font-medium">প্রতি পোস্টে সময়ের ব্যবধান</label>
          <select id="review-minute-gap" value={minutes} onChange={(e) => setMinutes(e.target.value)} className={selectClass}>
            {TIME_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value="custom">নিজের মতো মিনিট</option>
          </select>
          {minutes === "custom" && <Input type="number" aria-label="নিজের সময়ের ব্যবধান (মিনিট)" min="0" step="1" value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value)} />}
        </div>
        <div className="min-w-0 space-y-1.5">
          <label htmlFor="review-day-gap" className="text-xs font-medium">প্রতি পোস্টে অতিরিক্ত দিনের ব্যবধান</label>
          <select id="review-day-gap" value={days} onChange={(e) => setDays(e.target.value)} className={selectClass}>
            <option value="0">0 দিন — একই দিন</option>
            {[1, 2, 3, 7].map((value) => <option key={value} value={value}>{value} দিন</option>)}
            <option value="custom">নিজের মতো দিন</option>
          </select>
          {days === "custom" && <Input type="number" aria-label="নিজের দিনের ব্যবধান" min="0" step="1" value={customDays} onChange={(e) => setCustomDays(e.target.value)} />}
        </div>
      </div>
      <Button variant="outline" disabled={count === 0} className="w-full sm:w-auto" onClick={() => {
        try {
          onApply({ d: date, t: time }, Number(minutes === "custom" ? customMinutes : minutes), Number(days === "custom" ? customDays : days));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "সময় সাজানো যায়নি");
        }
      }}><ListOrdered className="mr-2 h-4 w-4" />রিভিউ পোস্টের সময় সাজান</Button>
    </div>
  );
}