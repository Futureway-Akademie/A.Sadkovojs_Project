import { Alert, ButtonLink, Container, Icon, Panel, Section, Specs } from "./ui";

type Query = Record<string, string | string[] | undefined>;
const value = (input: string | string[] | undefined) => Array.isArray(input) ? input[0] : input;

export function ConfirmationPage({ params }: { params: Query }) {
  const duplicate = value(params.duplicate) === "1";
  const ticket = value(params.ticket);
  const humanReview = value(params.human_review) === "true";
  const attachments = value(params.attachments) ?? "0";
  return <Section tone="page"><Container><div className="confirmation">
    <Panel accent={duplicate ? "blue" : "lime"} className="success-panel">
      <span className="success-panel__icon"><Icon name={duplicate ? "info" : "check"} size={30} /></span>
      <div><p className="eyebrow">{duplicate ? "Bereits übermittelt" : "Serviceanfrage eingegangen"}</p><h1>{duplicate ? "Ihre Serviceanfrage wurde bereits übermittelt." : "Ihre Anfrage ist beim Service Desk eingegangen."}</h1><p>{duplicate ? "Eine erneute Übertragung ist nicht erforderlich." : "Priorität, Termin und kommerzielle Bedingungen werden nach der Prüfung bestätigt."}</p></div>
      <Specs items={[...(ticket ? [{ label: "Ticket", value: ticket, mono: true }] : []), { label: "Anhänge", value: attachments, mono: true }]} />
    </Panel>
    {humanReview && <Alert tone="danger" lead="Menschliche Prüfung erforderlich.">Dieser Fall wird als kritisch behandelt und muss durch einen Menschen geprüft werden. Bitte melden Sie ihn zusätzlich telefonisch unter <a href="tel:+4962100000">+49 621 00000-0</a>.</Alert>}
    <Panel><h2>Wie es weitergeht</h2><Specs items={[{ label: "Prüfung", value: "Der Service Desk prüft Angaben und Auswirkung" }, { label: "Rückmeldung", value: "Per E-Mail an die angegebene Adresse oder telefonisch" }, { label: "Abstimmung", value: "Termin, Umfang und Konditionen werden bestätigt" }, { label: "Rückfragen", value: "+49 621 00000-0, Mo–Fr 07:00–18:00", mono: true }]} /></Panel>
    <Alert tone="warning" lead="24/7 nur mit SLA.">Der 24/7-Notfallkanal steht ausschließlich Kunden mit einem vereinbarten Notfall-SLA zur Verfügung. Ohne SLA gelten die Servicezeiten Mo–Fr 07:00–18:00.</Alert>
    <div className="button-row"><ButtonLink href="/">Zur Startseite</ButtonLink></div>
  </div></Container></Section>;
}
