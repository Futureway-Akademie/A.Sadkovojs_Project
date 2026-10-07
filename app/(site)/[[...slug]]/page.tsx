import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConfirmationPage } from "@/components/confirmation-page";
import { ServiceRequestForm } from "@/components/service-form";
import { AboutPage, ContactPage, HomePage, IndustriesPage, LegalPage, ServiceDetailPage, ServicesPage } from "@/components/pages";

type Props = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const titles: Record<string, string> = {
  "": "RheinWerk Industrieservice",
  leistungen: "Leistungen",
  "leistungen/inspektion": "Inspektion",
  "leistungen/wartung": "Planmäßige Wartung",
  "leistungen/fehlerdiagnose-reparatur": "Diagnose und Reparatur",
  "anlagen-und-branchen": "Anlagen und Branchen",
  "preise-und-sla": "Preise und SLA",
  "ueber-uns": "Über uns",
  serviceanfrage: "Serviceanfrage",
  bestaetigung: "Anfrage übermittelt",
  kontakt: "Kontakt",
  impressum: "Impressum",
  datenschutz: "Datenschutz",
  "cookie-richtlinie": "Cookie-Richtlinie",
  kundenbedingungen: "Kundenbedingungen",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const key = (await params).slug?.join("/") ?? "";
  return { title: titles[key] ?? "Seite nicht gefunden" };
}

export default async function Page({ params, searchParams }: Props) {
  const key = (await params).slug?.join("/") ?? "";
  if (key === "") return <HomePage />;
  if (key === "leistungen" || key === "preise-und-sla") return <ServicesPage />;
  if (key === "leistungen/inspektion") return <ServiceDetailPage type="inspektion" />;
  if (key === "leistungen/wartung") return <ServiceDetailPage type="wartung" />;
  if (key === "leistungen/fehlerdiagnose-reparatur") return <ServiceDetailPage type="reparatur" />;
  if (key === "anlagen-und-branchen") return <IndustriesPage />;
  if (key === "ueber-uns") return <AboutPage />;
  if (key === "serviceanfrage") return <ServiceRequestForm />;
  if (key === "bestaetigung") return <ConfirmationPage params={await searchParams} />;
  if (key === "kontakt") return <ContactPage />;
  if (key === "impressum") return <LegalPage kind="impressum" />;
  if (key === "datenschutz") return <LegalPage kind="datenschutz" />;
  if (key === "cookie-richtlinie") return <LegalPage kind="cookies" />;
  if (key === "kundenbedingungen") return <LegalPage kind="kundenbedingungen" />;
  notFound();
}
