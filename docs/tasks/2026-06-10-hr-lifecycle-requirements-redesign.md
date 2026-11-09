# HR Lifecycle Redesign Plan

Date: 2026-06-10
Owner: Codex
Repos:
- `owner-hotel-services-api`
- `owner-hotel-services`

## Problem Summary

The current HR Lifecycle feature behaves like a manual document-entry screen instead of a lifecycle management system.

Current pain points:

1. HR users must decide manually which documents each employee needs.
2. Document types are hardcoded in the UI/API flow rather than managed as HR master data.
3. Onboarding tasks are seeded from one default checklist and are not role-aware.
4. The lifecycle screen starts from "add document" instead of "what is missing for this employee?"
5. Bulk actions are focused on data entry, not operational control.
6. The employee record already stores useful setup attributes such as `propertyId`, `departmentId`, `positionId`, `employmentType`, and `startDate`, but lifecycle logic does not use them to assign requirements.

## What Mature HR Systems Usually Do

Based on public product documentation from Personio, mature HRIS products follow this pattern:

1. Core HR is the source of truth for employee data.
2. Document categories and templates are configured centrally.
3. Onboarding is driven by templates and workflow automation.
4. Requirements are assigned automatically by role, team, or workflow rules.
5. The daily UX focuses on:
   - missing items
   - uploaded items
   - verified items
   - expiring items
   - overdue tasks

Useful references:
- Personio Core HR: <https://www.personio.com/product/core-hr-software/>
- Personio Onboarding: <https://www.personio.com/product/onboarding/>
- Personio Workflow Automation: <https://www.personio.com/product/workflow-automation/>
- Personio Documents & e-Signature: <https://www.personio.com/product/electronic-signature/>

## Gap Analysis Against Current StaySync

### Existing strengths

- Employee master data already includes the right base fields in `CreateEmployeeDto`.
- HR departments and positions already exist as master data.
- Employee documents already support metadata such as expiry date, access level, and audit logging.
- Onboarding tasks already exist and support completion tracking.

### Missing foundation

The system currently lacks these layers:

1. `Document Type Setup`
2. `Lifecycle Package`
3. `Assignment Rule`
4. `Employee Document Requirement`
5. `Employee Lifecycle Package Assignment`

Without these layers, the UI will keep feeling manual even if the modal is visually improved.

## Recommended Target Architecture

### 1. Master data layer

Add configurable entities:

- `HrDocumentType`
  - name
  - code
  - category
  - requiredByDefault
  - hasExpiry
  - expiryPolicyDays
  - accessLevel
  - requiresVerification
  - allowedFileTypes
  - sortOrder
  - isActive

- `HrLifecyclePackage`
  - name
  - code
  - lifecycleType (`onboarding`, `offboarding`, `probation`, `compliance`)
  - description
  - isActive

- `HrLifecyclePackageDocument`
  - packageId
  - documentTypeId
  - isRequired
  - dueOffsetDays
  - ruleNote
  - sortOrder

- `HrLifecyclePackageTask`
  - packageId
  - title
  - category
  - ownerRole
  - dueOffsetDays
  - sortOrder
  - requiresApproval

- `HrLifecycleAssignmentRule`
  - packageId
  - propertyId nullable
  - departmentId nullable
  - positionId nullable
  - employmentType nullable
  - nationality nullable
  - isForeignWorker nullable
  - priority
  - isActive

### 2. Runtime layer

Add runtime entities:

- `HrEmployeeDocumentRequirement`
  - employeeId
  - documentTypeId
  - packageId nullable
  - status (`missing`, `uploaded`, `verified`, `waived`, `expired`)
  - dueDate
  - uploadedDocumentId nullable
  - verifiedBy nullable
  - verifiedAt nullable
  - waivedReason nullable

- `HrEmployeeLifecycleAssignment`
  - employeeId
  - packageId
  - sourceRuleId nullable
  - assignedAt
  - assignedBy nullable
  - status (`active`, `completed`, `cancelled`)

## Hotel-Specific Lifecycle Packages

Recommended starter packages for hotel operations:

1. `NEW_HIRE_FRONT_OFFICE`
   - ID card / passport
   - employment contract
   - PDPA consent
   - uniform issue
   - PMS account creation
   - shift allocation
   - service standards training

2. `NEW_HIRE_HOUSEKEEPING`
   - ID card
   - contract
   - health certificate
   - uniform issue
   - equipment issue
   - safety training
   - room standards induction

3. `NEW_HIRE_FNB`
   - ID card
   - contract
   - health certificate
   - food safety training
   - POS account
   - uniform issue

4. `FOREIGN_WORKER`
   - passport
   - visa
   - work permit
   - contract
   - local compliance forms

5. `OFFBOARDING_STANDARD`
   - account revocation
   - uniform return
   - equipment clearance
   - final document pack
   - exit checklist

## How It Should Connect to Employee Management

### On employee creation

When a new employee is created:

1. Save employee master record.
2. Evaluate active lifecycle assignment rules.
3. Assign matching lifecycle packages.
4. Generate:
   - document requirements
   - onboarding tasks
5. Return lifecycle summary as part of the employee setup response if needed.

### On employee change

When HR updates:

- department
- position
- property
- employment type

the system should:

1. recalculate rule matches
2. propose or auto-apply package changes
3. preserve already completed items when valid
4. mark no-longer-needed items as waived/cancelled instead of silently deleting them

## UX Direction

### Replace "upload-first" UI with "requirements-first" UI

The lifecycle screen should show:

1. Overview cards
   - Missing documents
   - Expiring documents
   - Pending onboarding tasks
   - Verified completion rate

2. Required documents table
   - document type
   - required / optional
   - due date
   - status
   - assigned package
   - upload / replace / verify / waive actions

3. Onboarding tasks table
   - task
   - owner
   - due date
   - status
   - notes

4. Bulk actions
   - assign package
   - request missing documents
   - upload one file to many requirements only when business-appropriate
   - verify selected items

### Important UX rule

HR should not start from a blank modal.

HR should start from:
"What is this employee still missing?"

## Delivery Plan

### Phase 1: Data model and API foundation

Backend:

1. Add Prisma models for:
   - document types
   - lifecycle packages
   - package documents
   - package tasks
   - assignment rules
   - employee lifecycle assignments
   - employee document requirements
2. Add DTOs, services, and controllers for new master data endpoints.
3. Add lifecycle assignment service to evaluate rules and generate requirements/tasks.

### Phase 2: Employee integration

Backend:

1. Hook lifecycle assignment into employee create flow.
2. Add recompute endpoint for employee lifecycle.
3. Add query endpoint for lifecycle summary by employee.

### Phase 3: Requirement-driven UI

Frontend:

1. Add settings screens:
   - document types
   - lifecycle packages
   - assignment rules
2. Redesign lifecycle page around requirements and statuses.
3. Keep upload modal only as a secondary action on a requirement row.

### Phase 4: Bulk operations

Frontend + Backend:

1. assign package in bulk
2. reseed onboarding in bulk
3. verify multiple uploaded documents
4. export missing/expiring report

## Immediate Implementation Recommendation

Start with these first:

1. Prisma schema for new lifecycle setup entities
2. API endpoints for document types and lifecycle packages
3. lifecycle-assignment service
4. employee create hook to generate assignments
5. frontend settings UI only after the API foundation exists

## Existing Files That Will Be Touched

Backend:

- `prisma/schema.prisma`
- `src/modules/hr/hr.module.ts`
- `src/modules/hr/hr.service.ts`
- `src/modules/hr/hr-onboarding.service.ts`
- `src/modules/hr/hr-employee-document.service.ts`
- new DTO/controller/service files under `src/modules/hr/`

Frontend:

- `app/dashboard/hr/lifecycle/page.tsx`
- `app/hr/lifecycle/page.tsx`
- new settings pages under `app/dashboard/hr/settings` or `app/dashboard/hr/master-data`
- `lib/api/hrLifecycle.ts`
- `lib/stores/hrLifecycleStore.ts`

## Success Criteria

The redesign is successful when:

1. HR can create an employee and immediately see required documents and tasks without manual setup.
2. Different departments and positions get different lifecycle packages automatically.
3. The lifecycle page answers:
   - what is missing
   - what is expiring
   - what is complete
   - who owns the next step
4. Bulk HR actions reduce admin work instead of increasing form entry.
