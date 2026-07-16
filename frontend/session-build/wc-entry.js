/* Self-hosted WalletConnect client. Loading this from esm.sh at connect time
   made login hostage to a third-party CDN that builds bundles on demand;
   mobile radios and cold CDN caches turned that into "Importing a module
   script failed". Served from our own origin instead, like session-lib. */
import { SignClient } from '@walletconnect/sign-client';

window.WcSignClient = SignClient;
