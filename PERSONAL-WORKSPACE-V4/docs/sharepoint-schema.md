# SharePoint production schema

## Provisioning

The production adapter uses eight generic lists on one dedicated SharePoint site. After the service principal has an explicit `Sites.Selected` write grant and the shell has an approved credential, run:

```powershell
pnpm sharepoint:provision
```

The script is additive and idempotent: it finds lists/columns by name, creates missing schema, creates one sequence/settings item, seeds project types, and prints the environment IDs. It does not delete or change existing columns. Review changes in a non-production site before upgrading a live schema.

All domain UUIDs are stored in `SCLI_Id`, not SharePoint item IDs. `Title` is the built-in text column. Dates/times are stored as UTC ISO values; `RequiredDeliveryDate` is treated as a date. Choice values must stay aligned with `packages/domain/src/types.ts`.

Legend: **R** = required; **Index** = provisioning/index recommendation for common lookups. SharePoint's built-in item ID and metadata columns are omitted because they do not map to the domain.

## `SCLI_AppUsers`

| Column                | SharePoint type        |   R | Index | Domain mapping / purpose                            |
| --------------------- | ---------------------- | --: | ----: | --------------------------------------------------- |
| `Title`               | Single line text       | Yes |    No | `AppUser.displayName`                               |
| `SCLI_Id`             | Single line text (36)  | Yes |   Yes | `AppUser.id` UUID                                   |
| `EntraObjectId`       | Single line text (64)  | Yes |   Yes | `AppUser.entraObjectId`; production identity lookup |
| `Email`               | Single line text       | Yes |   Yes | `AppUser.email`                                     |
| `JobTitle`            | Single line text       |  No |    No | `AppUser.jobTitle`                                  |
| `Department`          | Single line text       |  No |    No | `AppUser.department`                                |
| `AppRole`             | Choice                 | Yes |   Yes | `AppUser.role`: Sales, Designer, LineManager, Admin |
| `WeeklyCapacityHours` | Number                 |  No |    No | `AppUser.weeklyCapacityHours`                       |
| `AvailabilityStatus`  | Choice                 | Yes |   Yes | Available, Limited, FullyLoaded, Unavailable        |
| `AvatarUrl`           | Single line text (500) |  No |    No | `AppUser.avatarUrl`                                 |
| `IsActive`            | Yes/No                 |  No |   Yes | `AppUser.isActive`; inactive users cannot sign in   |
| `CreatedAtUtc`        | Date/time              |  No |    No | `AppUser.createdAt`                                 |
| `UpdatedAtUtc`        | Date/time              |  No |    No | `AppUser.updatedAt`                                 |

## `SCLI_Projects`

| Column                      | SharePoint type        |   R | Index | Domain mapping / purpose                            |
| --------------------------- | ---------------------- | --: | ----: | --------------------------------------------------- |
| `Title`                     | Single line text       | Yes |   Yes | `Project.projectCode`; immutable display code       |
| `SCLI_Id`                   | Single line text (36)  | Yes |   Yes | `Project.id` UUID                                   |
| `ProjectName`               | Single line text       | Yes |    No | `Project.projectName`                               |
| `ClientName`                | Single line text       | Yes |   Yes | `Project.clientName`                                |
| `ProjectType`               | Single line text       | Yes |   Yes | `Project.projectType` snapshot                      |
| `Description`               | Multiple lines text    |  No |    No | `Project.description`, plain text                   |
| `SalesOwnerId`              | Single line text (36)  | Yes |   Yes | `Project.salesOwnerId`                              |
| `SalesOwnerName`            | Single line text       |  No |    No | `Project.salesOwnerNameSnapshot`                    |
| `SalesOwnerEmail`           | Single line text       |  No |    No | `Project.salesOwnerEmailSnapshot`                   |
| `CreatedById`               | Single line text (36)  | Yes |    No | `Project.createdById`                               |
| `CreatedByName`             | Single line text       |  No |    No | `Project.createdByNameSnapshot`                     |
| `CreatedByEmail`            | Single line text       |  No |    No | `Project.createdByEmailSnapshot`                    |
| `DesignerId`                | Single line text (36)  |  No |   Yes | `Project.assignedDesignerId`                        |
| `DesignerName`              | Single line text       |  No |    No | `Project.assignedDesignerNameSnapshot`              |
| `CollaboratorDesignerIds`   | Multiple lines text    |  No |    No | JSON array of collaborating Lighting Designer UUIDs |
| `CollaboratorDesignerNames` | Multiple lines text    |  No |    No | JSON array of collaborator name snapshots           |
| `SiteLocation`              | Single line text       | Yes |    No | `Project.siteLocation`                              |
| `DesignStage`               | Choice                 | Yes |    No | Concept through AsBuilt                             |
| `LightingScope`             | Multiple lines text    | Yes |    No | `Project.lightingScope`, plain text                 |
| `LuxRequirements`           | Multiple lines text    |  No |    No | `Project.luxRequirements`, plain text               |
| `DrawingReference`          | Single line text (300) |  No |    No | `Project.drawingReference`                          |
| `ProjectStatus`             | Choice                 | Yes |   Yes | `Project.status`; all 12 configured status values   |
| `Priority`                  | Choice                 | Yes |   Yes | Low, Normal, High, Urgent                           |
| `Complexity`                | Choice                 | Yes |    No | Small, Medium, Large                                |
| `EstimatedHours`            | Number                 | Yes |    No | `Project.estimatedHours`                            |
| `ActualHours`               | Number                 |  No |    No | `Project.actualHours`                               |
| `ProgressPercent`           | Number                 |  No |    No | `Project.progressPercent`                           |
| `RequiredDeliveryDate`      | Date/time              | Yes |   Yes | `Project.requiredDeliveryDate`                      |
| `ProjectFolderUrl`          | Single line text (500) |  No |    No | `Project.projectFolderUrl`; HTTPS only              |
| `RevisionNumber`            | Number                 |  No |    No | `Project.revisionNumber`                            |
| `RecordVersion`             | Number                 | Yes |    No | Collaborative edit version; starts at 1             |
| `CreatedAtUtc`              | Date/time              | Yes |   Yes | `Project.createdAt`                                 |
| `UpdatedAtUtc`              | Date/time              |  No |    No | `Project.updatedAt`                                 |
| `CompletedAtUtc`            | Date/time              |  No |    No | `Project.completedAt`                               |
| `CancelledAtUtc`            | Date/time              |  No |    No | `Project.cancelledAt`                               |
| `IdempotencyKey`            | Single line text (36)  |  No |   Yes | Create retry key; unique-by-service expectation     |

`ProjectStatus` choices: `NewRequest`, `UnderReview`, `Unassigned`, `Assigned`, `InProgress`, `WaitingForInformation`, `WaitingForSales`, `InternalReview`, `RevisionRequired`, `OnHold`, `Completed`, `Cancelled`.

`DesignStage` choices: `Concept`, `SchematicDesign`, `DetailedDesign`, `Tender`, `Construction`, `AsBuilt`.

## `SCLI_ProjectActivities`

| Column          | SharePoint type       |   R | Index | Domain mapping / purpose      |
| --------------- | --------------------- | --: | ----: | ----------------------------- |
| `Title`         | Single line text      | Yes |    No | `ProjectActivity.message`     |
| `SCLI_Id`       | Single line text (36) | Yes |   Yes | `ProjectActivity.id` UUID     |
| `ProjectId`     | Single line text (36) | Yes |   Yes | `ProjectActivity.projectId`   |
| `ActionType`    | Single line text      | Yes |   Yes | `ProjectActivity.actionType`  |
| `FieldName`     | Single line text      |  No |    No | `ProjectActivity.fieldName`   |
| `OldValue`      | Multiple lines text   |  No |    No | Serialized prior value        |
| `NewValue`      | Multiple lines text   |  No |    No | Serialized new value          |
| `ChangedById`   | Single line text (36) | Yes |    No | `ProjectActivity.changedById` |
| `ChangedByName` | Single line text      | Yes |    No | Actor name snapshot           |
| `CreatedAtUtc`  | Date/time             | Yes |   Yes | Immutable activity timestamp  |

The API exposes no activity update/delete method. SharePoint permissions should likewise restrict direct list editing to administrators/operations.

## `SCLI_ProjectComments`

| Column          | SharePoint type        |   R | Index | Domain mapping / purpose              |
| --------------- | ---------------------- | --: | ----: | ------------------------------------- |
| `Title`         | Single line text       | Yes |    No | First 200 characters for list display |
| `SCLI_Id`       | Single line text (36)  | Yes |   Yes | `ProjectComment.id`                   |
| `ProjectId`     | Single line text (36)  | Yes |   Yes | `ProjectComment.projectId`            |
| `CommentBody`   | Multiple lines text    | Yes |    No | `ProjectComment.body`, plain text     |
| `AuthorId`      | Single line text (36)  | Yes |    No | `ProjectComment.authorId`             |
| `AuthorName`    | Single line text       | Yes |    No | Author name snapshot                  |
| `AttachmentUrl` | Single line text (500) |  No |    No | Optional HTTPS reference URL          |
| `CreatedAtUtc`  | Date/time              | Yes |   Yes | `ProjectComment.createdAt`            |
| `UpdatedAtUtc`  | Date/time              |  No |    No | `ProjectComment.updatedAt`            |

## `SCLI_Notifications`

| Column             | SharePoint type       |   R | Index | Domain mapping / purpose          |
| ------------------ | --------------------- | --: | ----: | --------------------------------- |
| `Title`            | Single line text      | Yes |    No | `AppNotification.title`           |
| `SCLI_Id`          | Single line text (36) | Yes |   Yes | `AppNotification.id`              |
| `RecipientUserId`  | Single line text (36) | Yes |   Yes | `AppNotification.recipientUserId` |
| `NotificationType` | Single line text      | Yes |    No | `AppNotification.type`            |
| `Message`          | Multiple lines text   | Yes |    No | `AppNotification.message`         |
| `ProjectId`        | Single line text (36) |  No |   Yes | `AppNotification.projectId`       |
| `IsRead`           | Yes/No                |  No |   Yes | `AppNotification.isRead`          |
| `CreatedAtUtc`     | Date/time             | Yes |   Yes | `AppNotification.createdAt`       |

## `SCLI_ProjectSequence`

| Column         | SharePoint type  |   R | Index | Domain mapping / purpose                 |
| -------------- | ---------------- | --: | ----: | ---------------------------------------- |
| `Title`        | Single line text | Yes |    No | Human label, normally `Project sequence` |
| `SequenceKey`  | Single line text | Yes |   Yes | Stable key `projects`                    |
| `LastNumber`   | Number           | Yes |    No | Last reserved project sequence           |
| `UpdatedAtUtc` | Date/time        |  No |    No | Last reservation timestamp               |

There is exactly one configured sequence item. `SP_SEQUENCE_ITEM_ID` is its SharePoint item ID. The adapter reads its ETag and PATCHes `LastNumber` with `If-Match`; do not manually edit it during project creation traffic.

## `SCLI_ProjectTypes`

| Column         | SharePoint type       |   R | Index | Domain mapping / purpose |
| -------------- | --------------------- | --: | ----: | ------------------------ |
| `Title`        | Single line text      | Yes |    No | `ProjectType.name`       |
| `SCLI_Id`      | Single line text (36) | Yes |   Yes | `ProjectType.id`         |
| `IsActive`     | Yes/No                |  No |   Yes | `ProjectType.isActive`   |
| `CreatedAtUtc` | Date/time             |  No |    No | `ProjectType.createdAt`  |
| `UpdatedAtUtc` | Date/time             |  No |    No | `ProjectType.updatedAt`  |

Initial values: Lighting Layout, Lux Calculations, DIALux Simulation, Luminaire Schedule, Lighting Controls, Emergency Lighting, Façade Lighting, Landscape Lighting, Shop Drawing Review, Tender Package, and Value Engineering.

## `SCLI_AppSettings`

| Column                      | SharePoint type       |   R | Index | Domain mapping / purpose                |
| --------------------------- | --------------------- | --: | ----: | --------------------------------------- |
| `Title`                     | Single line text      | Yes |    No | Human label `Application settings`      |
| `CompanyTimezone`           | Single line text      | Yes |    No | `AppSettings.companyTimezone`           |
| `TeamsNotificationsEnabled` | Yes/No                |  No |    No | `AppSettings.teamsNotificationsEnabled` |
| `UpdatedAtUtc`              | Date/time             |  No |    No | `AppSettings.updatedAt`                 |
| `UpdatedById`               | Single line text (36) |  No |    No | `AppSettings.updatedById`               |

There is one settings item. Timezone values must be valid IANA names supported by the Node runtime, with `Asia/Dubai` as the default.

## Scale, indexing and operations

The adapter follows Graph pagination at 200 items per page and applies stable sorting. Keep indexes on status, owner, Primary Lighting Designer, priority, required/created dates, IDs and notification recipient/read fields. Collaborator arrays are stored as JSON for portability and are filtered by the API; a future high-scale migration should normalize those memberships. For larger-than-assumed datasets, move equality filters into Graph list queries and verify SharePoint threshold behavior in the tenant before exceeding the documented V1 scale.

Do not rename columns after provisioning without updating both the adapter mapping and this document. Back up/retain lists through company SharePoint policy; application rollback must not delete schema or data.
