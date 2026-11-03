import { Link } from 'react-router-dom';

const updatedAt = 'November 3, 2026';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-foreground text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="text-muted-foreground space-y-3 leading-7">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <title>Privacy Policy | OpenAthlete</title>
      <main className="bg-background text-foreground min-h-screen">
        <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
          <header className="border-border mb-10 border-b pb-8">
            <Link
              to="/"
              className="text-primary text-sm font-semibold tracking-wide"
            >
              OpenAthlete
            </Link>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Privacy Policy
            </h1>
            <p className="text-muted-foreground mt-4">
              Last updated: {updatedAt}
            </p>
          </header>

          <div className="space-y-10">
            <Section title="1. About this service">
              <p>
                OpenAthlete is a self-hosted endurance training platform. This
                policy describes how the OpenAthlete instance available at
                athlete.jonathanbertoldi.com.br processes personal information
                when athletes and coaches use the service.
              </p>
            </Section>

            <Section title="2. Information we process">
              <p>Depending on the features you use, we may process:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>account information, such as name and email address;</li>
                <li>
                  training plans, workouts, calendar entries, comments and
                  athlete-coach relationships;
                </li>
                <li>
                  activity and device data, including routes, location tracks,
                  distance, duration, pace, power, cadence, heart rate and
                  equipment information;
                </li>
                <li>
                  health and wellness data you authorize a connected provider to
                  share, such as sleep, daily summaries, HRV, stress,
                  respiration and body-composition measurements; and
                </li>
                <li>
                  limited technical logs needed to secure, diagnose and operate
                  the service.
                </li>
              </ul>
            </Section>

            <Section title="3. Connected services">
              <p>
                You may choose to connect services such as Garmin or Strava.
                OpenAthlete uses the authorization granted by you to import
                activities and health summaries and, when supported, export
                workouts you create to your device account.
              </p>
              <p>
                We only request and process provider data needed for the
                features you enable. We do not sell, license or broker Garmin,
                Strava or other device-sourced data, and we do not use it for
                advertising.
              </p>
            </Section>

            <Section title="4. How information is used">
              <p>Information is processed to:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>provide training, calendar and activity features;</li>
                <li>calculate training and recovery insights;</li>
                <li>sync data with services you explicitly connect;</li>
                <li>secure accounts and prevent abuse; and</li>
                <li>maintain, troubleshoot and improve this instance.</li>
              </ul>
            </Section>

            <Section title="5. Storage and service providers">
              <p>
                This instance is hosted on infrastructure provided by Hostinger.
                Application data is stored in its private database, and
                temporary background-processing data may be held in Redis.
                Transactional email may be delivered through Brevo. These
                providers process only the information required to deliver their
                infrastructure or email services.
              </p>
              <p>
                Optional AI features remain inactive unless a user configures an
                AI provider and chooses to use them. When used, the selected
                context is sent to that provider under its own privacy terms.
              </p>
            </Section>

            <Section title="6. Legal basis and control">
              <p>
                Connected-provider and health data is processed at your request
                and with your authorization. Other account data is processed as
                necessary to provide and secure the service. You control which
                external services are connected and can revoke a connection at
                any time from the Connectors settings.
              </p>
            </Section>

            <Section title="7. Retention and deletion">
              <p>
                Information is retained while your account is active and as
                needed to operate the service. Disconnecting a provider revokes
                the connection and stops future synchronization. You may delete
                imported activities individually and may request or perform
                account deletion from the application. Account deletion removes
                the account and associated application data, subject only to
                short-lived operational backups and legal obligations.
              </p>
            </Section>

            <Section title="8. Sharing">
              <p>
                Data is shared only with infrastructure providers required to
                operate the service, with connected services at your direction,
                or when required by law. Coaches can access athlete information
                only through relationships established within OpenAthlete.
              </p>
            </Section>

            <Section title="9. Security">
              <p>
                We use HTTPS, access controls and encrypted provider credentials
                to protect information. No online service can guarantee absolute
                security, so users should keep their credentials private and
                promptly report suspected unauthorized access.
              </p>
            </Section>

            <Section title="10. Your rights and contact">
              <p>
                You may access, correct, export or delete your information and
                withdraw a connected-service authorization through the
                application. For privacy questions or requests, contact the
                administrator of this OpenAthlete instance through the account
                channel by which access to the service was provided.
              </p>
            </Section>

            <Section title="11. Changes to this policy">
              <p>
                This policy may be updated when the service, its providers or
                applicable requirements change. The date at the top identifies
                the latest revision.
              </p>
            </Section>
          </div>
        </div>
      </main>
    </>
  );
}
