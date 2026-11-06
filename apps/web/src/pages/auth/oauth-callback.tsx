import { useSetOAuthTokenMutation } from '@/api/provider';
import { LoadingScreen } from '@/components/loading-screen';
import { m } from '@/paraglide/messages';
import { getPath } from '@/routes/paths';
import {
  AnalyticsEvent,
  analyticsErrorCodeFromUnknown,
  consumeOauthConnectSource,
} from '@/utils/analytics-events';
import posthog from 'posthog-js';
import { useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ConnectorProvider } from '@openathlete/shared';

export function OAuthCallbackPage() {
  const { provider } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const hasInitialized = useRef(false);
  const setOAuthTokenMutation = useSetOAuthTokenMutation({
    onSuccess: () => {
      const source = consumeOauthConnectSource();
      const finalProvider = (provider || '').toUpperCase().replaceAll('-', '_');
      posthog.capture(AnalyticsEvent.provider_connect_completed, {
        provider: finalProvider,
        source,
      });
      toast.success(m.connected_successfully());
      nav(getPath(['dashboard', 'settings']));
    },
    onError: (error) => {
      const source = consumeOauthConnectSource();
      const finalProvider = (provider || '').toUpperCase().replaceAll('-', '_');
      posthog.capture(AnalyticsEvent.provider_connect_failed, {
        provider: finalProvider,
        source,
        error_code: analyticsErrorCodeFromUnknown(error),
      });
      toast.error(error.message);
      nav(getPath(['dashboard', 'settings']));
    },
  });

  useEffect(() => {
    // Prevent double execution in React Strict Mode
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const code = searchParams.get('code');
    const finalProvider = (provider || '').toUpperCase().replaceAll('-', '_');
    const validProviders = [
      'STRAVA',
      'GARMIN',
      'SUUNTO',
      'COROS',
      'POLAR',
      'INTERVALS',
      'GOOGLE_CALENDAR',
    ];

    const failInvalid = () => {
      const source = consumeOauthConnectSource();
      posthog.capture(AnalyticsEvent.provider_connect_failed, {
        provider: finalProvider || 'unknown',
        source,
        error_code: 'invalid_oauth_callback',
      });
    };

    if (!(code && provider && validProviders.includes(finalProvider))) {
      failInvalid();
      nav(getPath(['dashboard', 'settings']));
      toast.error(m.invalid_provider());
      return;
    }

    // For Garmin (PKCE), retrieve codeVerifier from localStorage
    // Using localStorage instead of sessionStorage to persist across OAuth redirects
    const storageKey = `oauth_code_verifier_${finalProvider}`;
    const codeVerifier = localStorage.getItem(storageKey);

    // Garmin requires codeVerifier for PKCE flow
    if (finalProvider === 'GARMIN' && !codeVerifier) {
      console.error('Garmin OAuth: codeVerifier not found in localStorage');
      const source = consumeOauthConnectSource();
      posthog.capture(AnalyticsEvent.provider_connect_failed, {
        provider: finalProvider,
        source,
        error_code: 'missing_code_verifier',
      });
      toast.error(m.oauth_garmin_code_verifier_missing());
      nav(getPath(['dashboard', 'settings']));
      return;
    }

    // Clean up localStorage after retrieving
    if (codeVerifier) {
      localStorage.removeItem(storageKey);
    }

    setOAuthTokenMutation.mutate({
      provider: finalProvider as ConnectorProvider,
      code,
      ...(codeVerifier && { codeVerifier }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, searchParams]);

  return (
    <LoadingScreen
      message={m.importing_data_from_provider({ provider: provider || '' })}
    />
  );
}
