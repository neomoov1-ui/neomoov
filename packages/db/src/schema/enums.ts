/** Énumérations PostgreSQL, alignées sur les constantes de @neomoov/domain. */

import {
  AGENT_MODES, AGENT_RUN_STATUSES, APPROVAL_DECISIONS, COLLECTED_BY, COMPLIANCE_ENTITY_TYPES, CONSENT_PURPOSES, CREDIT_ORIGINS,
  DATA_REQUEST_TYPES, DOCUMENT_STATUSES, DOCUMENT_TYPES, DRIVER_QUALIFICATIONS, DRIVER_STATUSES, INCIDENT_SEVERITIES, INCIDENT_STATUSES,
  INCIDENT_TYPES, LANGUAGES, NOTIFICATION_CHANNELS, OFFER_STATES, OFFER_TYPES, PACK_BILLING_STATUSES, PACK_CODES, PACK_PURCHASE_STATUSES,
  PARTNER_TYPES, PAYMENT_METHODS, PAYMENT_STATUSES, PROMOTION_TYPES, RIDE_STATES, RIDE_TYPES, SANCTION_TYPES, SEV_STATUSES, STATEMENT_STATUSES,
  SURCHARGE_CODES, USER_ROLES, USER_STATUSES, VEHICLE_CATEGORIES, VEHICLE_STATUSES, ZONE_TYPES,
} from '@neomoov/domain';
import { pgEnum } from 'drizzle-orm/pg-core';

export const rideStateEnum = pgEnum('ride_state', RIDE_STATES);
export const rideTypeEnum = pgEnum('ride_type', RIDE_TYPES);
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const languageEnum = pgEnum('language', LANGUAGES);
export const vehicleCategoryEnum = pgEnum('vehicle_category', VEHICLE_CATEGORIES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const collectedByEnum = pgEnum('collected_by', COLLECTED_BY);
export const driverStatusEnum = pgEnum('driver_status', DRIVER_STATUSES);
export const driverQualificationEnum = pgEnum('driver_qualification', DRIVER_QUALIFICATIONS);
export const documentTypeEnum = pgEnum('document_type', DOCUMENT_TYPES);
export const documentStatusEnum = pgEnum('document_status', DOCUMENT_STATUSES);
export const vehicleStatusEnum = pgEnum('vehicle_status', VEHICLE_STATUSES);
export const zoneTypeEnum = pgEnum('zone_type', ZONE_TYPES);
export const surchargeCodeEnum = pgEnum('surcharge_code', SURCHARGE_CODES);
export const offerTypeEnum = pgEnum('offer_type', OFFER_TYPES);
export const offerStateEnum = pgEnum('offer_state', OFFER_STATES);
export const packCodeEnum = pgEnum('pack_code', PACK_CODES);
export const packPurchaseStatusEnum = pgEnum('pack_purchase_status', PACK_PURCHASE_STATUSES);
export const packBillingStatusEnum = pgEnum('pack_billing_status', PACK_BILLING_STATUSES);
export const statementStatusEnum = pgEnum('statement_status', STATEMENT_STATUSES);
export const promotionTypeEnum = pgEnum('promotion_type', PROMOTION_TYPES);
export const creditOriginEnum = pgEnum('credit_origin', CREDIT_ORIGINS);
export const consentPurposeEnum = pgEnum('consent_purpose', CONSENT_PURPOSES);
export const sevStatusEnum = pgEnum('sev_status', SEV_STATUSES);
export const incidentTypeEnum = pgEnum('incident_type', INCIDENT_TYPES);
export const incidentSeverityEnum = pgEnum('incident_severity', INCIDENT_SEVERITIES);
export const incidentStatusEnum = pgEnum('incident_status', INCIDENT_STATUSES);
export const sanctionTypeEnum = pgEnum('sanction_type', SANCTION_TYPES);
export const dataRequestTypeEnum = pgEnum('data_request_type', DATA_REQUEST_TYPES);
export const complianceEntityTypeEnum = pgEnum('compliance_entity_type', COMPLIANCE_ENTITY_TYPES);
export const agentModeEnum = pgEnum('agent_mode', AGENT_MODES);
export const agentRunStatusEnum = pgEnum('agent_run_status', AGENT_RUN_STATUSES);
export const approvalDecisionEnum = pgEnum('approval_decision', APPROVAL_DECISIONS);
export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const partnerTypeEnum = pgEnum('partner_type', PARTNER_TYPES);
