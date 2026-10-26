# Real-device release check

Use https://peer-share-jacob.onrender.com/ after the current release is deployed.
Keep results separate from the automated local tests.

## Accounts and devices

Use two different, verified accounts: one on the computer and one on the phone.
The app intentionally does not pair an account with itself. Verify each email,
then sign in. Opening the email on the phone does not update the computer's tab.
For a three-person group check, use a third account in another browser/device.

Keep the computer on its normal connection and switch the phone to mobile data
with Wi-Fi off. Keep the page open during a transfer; backgrounding a mobile
browser can interrupt WebRTC. Begin with a small text file or image below 1 MiB.

## Direct invitation and transfer

1. Copy the phone account's sharing ID and paste it into Recipient account ID on
   the computer. Choose Invite. Accept the matching invitation on the phone.
2. Confirm both show Encrypted connection established. Record Connection route
   on each: Direct or TURN relay. A relay candidate in logs alone does not prove
   the selected connection used TURN.
3. Send the small file from computer to phone. Confirm the file name/size, accept
   it, and wait for the verified download link. Save/open the file on the phone.
4. Send a different small file back from phone to computer and verify its download.
5. Try cancellation while a larger test file is in progress. Both sides should
   report cancelled and not publish an incomplete download. Retry a small file
   on the same connection.
6. Use Reconnect, send/accept a new invitation and transfer another small file.
7. Close the remote tab during a test transfer. Confirm the remaining browser
   reports the disconnect and does not offer an incomplete file as verified.

## Group

1. The owner adds and accepts the two other accounts as friends, creates a group,
   and each participant joins that saved group on its chosen device/browser.
2. Select both connected recipients. Send one small file; each accepts separately
   and gets its own verified download. A decline by one must not approve another.
3. Send a message and file from a non-owner. Check the correct sender and time.
4. Reconnect the group on each participating device and confirm messages/files
   can still be exchanged. Leave and rejoin one participant as another check.

## Relay and large-file limits

For an explicit public-relay check, first verify the provider settings and free
allowance, then temporarily set ICE_RELAY_ONLY=true on the test deployment and
redeploy. Reconnect both browsers so they fetch new ICE configuration. Both
should report TURN relay. Restore ICE_RELAY_ONLY=false and redeploy after testing.
No authentication or verification bypass is needed for this check.

Test small files first. Direct WebRTC traffic does not use a TURN allowance;
relayed traffic does. Some providers count both ingress and egress, and group
copies consume allowance per recipient. The application's 1 GiB per-file limit
is not a promise that a free relay plan has enough bandwidth for a 1 GiB file.
Do not run a public 1 GiB relay test unless the actual free allowance is adequate.

Metered/Open Relay currently advertises different allowances for different free
products. Use the quota displayed in this account's dashboard, not the marketing
page. Keep payment details and paid overages disabled.

The provider API key is stored only on the backend. The browser necessarily
receives the scoped TURN username/password. Credential expiry/revocation is
managed in Metered; rotate or revoke it there if required. The coturn option
continues to issue standard one-hour TURN REST credentials per request.

## Result record

| Check | Device/browser versions | Route | Result/notes |
| --- | --- | --- | --- |
| Verified sign-in | Versions not recorded | N/A | PASS: owner confirmed workspace access, 2026-10-26. |
| Computer to phone | Computer and phone; versions not recorded | TURN on both devices | PASS: owner confirmed file transfer/download worked over mobile data, 2026-10-26. |
| Phone to computer | Computer and phone; versions not recorded | TURN on both devices | PASS: owner confirmed reverse transfer/download worked, 2026-10-26. |
| Cancel and retry | Physical devices not yet checked | | Automated desktop check passed; physical-device check pending. |
| Disconnect and reconnect | Physical devices not yet checked | | Automated desktop check passed; physical-device check pending. |
| Three-person group | Desktop browser sessions | Local and public TURN | Automated check passed; phone-in-group check pending. |
| Public TURN selected | Computer and phone | TURN on both devices | PASS: owner reported TURN on each device under normal fallback configuration; relay-only was not forced on the deployed app. |
| Larger file | Physical devices not yet checked | | Desktop 1 GiB baseline passed; no real-phone large-file claim. |

Do not include passwords, session cookies, verification links, API keys or raw
ICE/SDP network addresses in the result record.
The physical-device report confirms small-file transfer in both directions,
with phone Wi-Fi off/mobile data enabled as instructed. Exact file sizes and
device/browser versions were not recorded. This is not a 1 GiB Safari test.
