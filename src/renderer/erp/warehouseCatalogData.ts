/**
 * 货盘仓库静态目录数据模块（自 PalletWarehousePage.tsx 原样抽离，抽离前后已做结构化对账：节点数/key 集合/每节点名称与图标完全一致）。
 * 内容：三级类目图标资产 import + MOCK_CATEGORIES（一二级类目树）+ MOCK_TERTIARY_CATALOG（三级类目 flyout 图标网格唯一来源）。
 * 警示（历史坑）：重构抽离内联数据数组会静默丢条目/字段——后续增删条目务必同步核对渲染效果。
 */
// 汽车内饰用品三级类目图标：原创白底商品缩略图（视觉规格同 1688 类目图标），flyout 内以 <img> 渲染
import iconOtherInterior from '../assets/pallet-warehouse-mock/tertiary/other-interior.png'
import iconPhoneMount from '../assets/pallet-warehouse-mock/tertiary/phone-mount.png'
import iconStorageBag from '../assets/pallet-warehouse-mock/tertiary/storage-bag.png'
import iconPerfume from '../assets/pallet-warehouse-mock/tertiary/perfume.png'
import iconSunShade from '../assets/pallet-warehouse-mock/tertiary/sun-shade.png'
import iconHeadrest from '../assets/pallet-warehouse-mock/tertiary/headrest.png'
import iconOrnament from '../assets/pallet-warehouse-mock/tertiary/ornament.png'
import iconHanging from '../assets/pallet-warehouse-mock/tertiary/hanging.png'
import iconKeyCase from '../assets/pallet-warehouse-mock/tertiary/key-case.png'
import iconWheelCover from '../assets/pallet-warehouse-mock/tertiary/wheel-cover.png'
import iconLumbarSupport from '../assets/pallet-warehouse-mock/tertiary/lumbar-support.png'
import iconCupHolder from '../assets/pallet-warehouse-mock/tertiary/cup-holder.png'
import iconParkingPlate from '../assets/pallet-warehouse-mock/tertiary/parking-plate.png'
import iconInflatableBed from '../assets/pallet-warehouse-mock/tertiary/inflatable-bed.png'
import iconBeltPad from '../assets/pallet-warehouse-mock/tertiary/belt-pad.png'
import iconAntiSlipMat from '../assets/pallet-warehouse-mock/tertiary/anti-slip-mat.png'
import iconCurtain from '../assets/pallet-warehouse-mock/tertiary/curtain.png'
import iconPedal from '../assets/pallet-warehouse-mock/tertiary/pedal.png'
import iconArmrestPad from '../assets/pallet-warehouse-mock/tertiary/armrest-pad.png'
import iconGearCover from '../assets/pallet-warehouse-mock/tertiary/gear-cover.png'
import iconGlassesClip from '../assets/pallet-warehouse-mock/tertiary/glasses-clip.png'
import iconArmrestBox from '../assets/pallet-warehouse-mock/tertiary/armrest-box.png'
import iconTissueBox from '../assets/pallet-warehouse-mock/tertiary/tissue-box.png'
import iconAshtray from '../assets/pallet-warehouse-mock/tertiary/ashtray.png'
import iconTableBoard from '../assets/pallet-warehouse-mock/tertiary/table-board.png'
import iconCharcoal from '../assets/pallet-warehouse-mock/tertiary/charcoal.png'
import iconWheelBooster from '../assets/pallet-warehouse-mock/tertiary/wheel-booster.png'
import iconDashMat from '../assets/pallet-warehouse-mock/tertiary/dash-mat.png'
import iconKickPad from '../assets/pallet-warehouse-mock/tertiary/kick-pad.png'
import iconPerfumeSeat from '../assets/pallet-warehouse-mock/tertiary/perfume-seat.png'
import iconThermometer from '../assets/pallet-warehouse-mock/tertiary/thermometer.png'
import iconVisorMirror from '../assets/pallet-warehouse-mock/tertiary/visor-mirror.png'
import iconStaticStick from '../assets/pallet-warehouse-mock/tertiary/static-stick.png'
import iconCdCase from '../assets/pallet-warehouse-mock/tertiary/cd-case.png'
import iconCompass from '../assets/pallet-warehouse-mock/tertiary/compass.png'
// 车身及附件三级类目图标：原创白底商品缩略图（视觉规格同 1688 类目图标）
import iconBodyOther from '../assets/pallet-warehouse-mock/tertiary/body-other.png'
import iconBodyCab from '../assets/pallet-warehouse-mock/tertiary/body-cab.png'
import iconBodyPlateFrame from '../assets/pallet-warehouse-mock/tertiary/body-plate-frame.png'
import iconBodyWindowLifter from '../assets/pallet-warehouse-mock/tertiary/body-window-lifter.png'
import iconBodyHorn from '../assets/pallet-warehouse-mock/tertiary/body-horn.png'
import iconBodyValve from '../assets/pallet-warehouse-mock/tertiary/body-valve.png'
import iconBodyMirror from '../assets/pallet-warehouse-mock/tertiary/body-mirror.png'
import iconBodyWiper from '../assets/pallet-warehouse-mock/tertiary/body-wiper.png'
import iconBodyExhaustPipe from '../assets/pallet-warehouse-mock/tertiary/body-exhaust-pipe.png'
import iconBodyHandle from '../assets/pallet-warehouse-mock/tertiary/body-handle.png'
import iconBodySealStrip from '../assets/pallet-warehouse-mock/tertiary/body-seal-strip.png'
import iconBodyGrille from '../assets/pallet-warehouse-mock/tertiary/body-grille.png'
import iconBodyAntenna from '../assets/pallet-warehouse-mock/tertiary/body-antenna.png'
import iconBodyBearing from '../assets/pallet-warehouse-mock/tertiary/body-bearing.png'
import iconBodyLuggageRack from '../assets/pallet-warehouse-mock/tertiary/body-luggage-rack.png'
import iconBodySeat from '../assets/pallet-warehouse-mock/tertiary/body-seat.png'
import iconBodyBumper from '../assets/pallet-warehouse-mock/tertiary/body-bumper.png'
import iconBodyMuffler from '../assets/pallet-warehouse-mock/tertiary/body-muffler.png'
import iconBodyUnderGuard from '../assets/pallet-warehouse-mock/tertiary/body-under-guard.png'
import iconBodySideMirror from '../assets/pallet-warehouse-mock/tertiary/body-side-mirror.png'
import iconBodyBattery from '../assets/pallet-warehouse-mock/tertiary/body-battery.png'
import iconBodyFender from '../assets/pallet-warehouse-mock/tertiary/body-fender.png'
import iconBodyStamping from '../assets/pallet-warehouse-mock/tertiary/body-stamping.png'
import iconBodyDoor from '../assets/pallet-warehouse-mock/tertiary/body-door.png'
import iconBodyGlass from '../assets/pallet-warehouse-mock/tertiary/body-glass.png'
import iconBodyAirbag from '../assets/pallet-warehouse-mock/tertiary/body-airbag.png'
import iconBodyShell from '../assets/pallet-warehouse-mock/tertiary/body-shell.png'
// 剩余 12 个二级类目三级图标：原创白底商品缩略图（视觉规格同 1688 类目瓷砖）
import iconExtOther from '../assets/pallet-warehouse-mock/tertiary/ext-other.png'
import iconExtCarCover from '../assets/pallet-warehouse-mock/tertiary/ext-car-cover.png'
import iconExtBodySticker from '../assets/pallet-warehouse-mock/tertiary/ext-body-sticker.png'
import iconExtOrnament from '../assets/pallet-warehouse-mock/tertiary/ext-ornament.png'
import iconExtBumperStrip from '../assets/pallet-warehouse-mock/tertiary/ext-bumper-strip.png'
import iconExtSnowShade from '../assets/pallet-warehouse-mock/tertiary/ext-snow-shade.png'
import iconExtWheelCap from '../assets/pallet-warehouse-mock/tertiary/ext-wheel-cap.png'
import iconExtBlindMirror from '../assets/pallet-warehouse-mock/tertiary/ext-blind-mirror.png'
import iconExtBodyKit from '../assets/pallet-warehouse-mock/tertiary/ext-body-kit.png'
import iconExtMudFlap from '../assets/pallet-warehouse-mock/tertiary/ext-mud-flap.png'
import iconExtSpoiler from '../assets/pallet-warehouse-mock/tertiary/ext-spoiler.png'
import iconExtRainGuard from '../assets/pallet-warehouse-mock/tertiary/ext-rain-guard.png'
import iconExtWindowFilm from '../assets/pallet-warehouse-mock/tertiary/ext-window-film.png'
import iconExtTireCover from '../assets/pallet-warehouse-mock/tertiary/ext-tire-cover.png'
import iconExtWindowTrim from '../assets/pallet-warehouse-mock/tertiary/ext-window-trim.png'
import iconExtLogo from '../assets/pallet-warehouse-mock/tertiary/ext-logo.png'
import iconExtFuelCap from '../assets/pallet-warehouse-mock/tertiary/ext-fuel-cap.png'
import iconExtDisturber from '../assets/pallet-warehouse-mock/tertiary/ext-disturber.png'
import iconExtStabilizer from '../assets/pallet-warehouse-mock/tertiary/ext-stabilizer.png'
import iconExtDoorHandle from '../assets/pallet-warehouse-mock/tertiary/ext-door-handle.png'
import iconExtInsectNet from '../assets/pallet-warehouse-mock/tertiary/ext-insect-net.png'
import iconExtSoundCotton from '../assets/pallet-warehouse-mock/tertiary/ext-sound-cotton.png'
import iconExtWheelArch from '../assets/pallet-warehouse-mock/tertiary/ext-wheel-arch.png'
import iconExtWrapFilm from '../assets/pallet-warehouse-mock/tertiary/ext-wrap-film.png'
import iconExtLightBrow from '../assets/pallet-warehouse-mock/tertiary/ext-light-brow.png'
import iconExtLightFrame from '../assets/pallet-warehouse-mock/tertiary/ext-light-frame.png'
import iconExtMirrorFilm from '../assets/pallet-warehouse-mock/tertiary/ext-mirror-film.png'
import iconExtPaintFilm from '../assets/pallet-warehouse-mock/tertiary/ext-paint-film.png'
import iconExtHeadlightFilm from '../assets/pallet-warehouse-mock/tertiary/ext-headlight-film.png'
import iconExtSunroof from '../assets/pallet-warehouse-mock/tertiary/ext-sunroof.png'
import iconExtCaliperCover from '../assets/pallet-warehouse-mock/tertiary/ext-caliper-cover.png'
import iconExtBikeRack from '../assets/pallet-warehouse-mock/tertiary/ext-bike-rack.png'
import iconExtElSheet from '../assets/pallet-warehouse-mock/tertiary/ext-el-sheet.png'
import iconMotoBag from '../assets/pallet-warehouse-mock/tertiary/moto-bag.png'
import iconMotoParts from '../assets/pallet-warehouse-mock/tertiary/moto-parts.png'
import iconMotoHelmet from '../assets/pallet-warehouse-mock/tertiary/moto-helmet.png'
import iconMotoProtect from '../assets/pallet-warehouse-mock/tertiary/moto-protect.png'
import iconMotoIntercom from '../assets/pallet-warehouse-mock/tertiary/moto-intercom.png'
import iconMotoTailBox from '../assets/pallet-warehouse-mock/tertiary/moto-tail-box.png'
import iconMotoMirror from '../assets/pallet-warehouse-mock/tertiary/moto-mirror.png'
import iconMotoVisor from '../assets/pallet-warehouse-mock/tertiary/moto-visor.png'
import iconMotoEngine from '../assets/pallet-warehouse-mock/tertiary/moto-engine.png'
import iconMotoSeat from '../assets/pallet-warehouse-mock/tertiary/moto-seat.png'
import iconMotoGrip from '../assets/pallet-warehouse-mock/tertiary/moto-grip.png'
import iconMotoWindshield from '../assets/pallet-warehouse-mock/tertiary/moto-windshield.png'
import iconMotoExhaust from '../assets/pallet-warehouse-mock/tertiary/moto-exhaust.png'
import iconMotoMeter from '../assets/pallet-warehouse-mock/tertiary/moto-meter.png'
import iconMotoFootboard from '../assets/pallet-warehouse-mock/tertiary/moto-footboard.png'
import iconMotoDecal from '../assets/pallet-warehouse-mock/tertiary/moto-decal.png'
import iconMotoTransmission from '../assets/pallet-warehouse-mock/tertiary/moto-transmission.png'
import iconMotoLever from '../assets/pallet-warehouse-mock/tertiary/moto-lever.png'
import iconMotoFender from '../assets/pallet-warehouse-mock/tertiary/moto-fender.png'
import iconMotoBumper from '../assets/pallet-warehouse-mock/tertiary/moto-bumper.png'
import iconMotoFrame from '../assets/pallet-warehouse-mock/tertiary/moto-frame.png'
import iconMotoKey from '../assets/pallet-warehouse-mock/tertiary/moto-key.png'
import iconMotoPlate from '../assets/pallet-warehouse-mock/tertiary/moto-plate.png'
import iconMotoLock from '../assets/pallet-warehouse-mock/tertiary/moto-lock.png'
import iconMotoCarburetor from '../assets/pallet-warehouse-mock/tertiary/moto-carburetor.png'
import iconMotoWheelPart from '../assets/pallet-warehouse-mock/tertiary/moto-wheel-part.png'
import iconMotoTailWing from '../assets/pallet-warehouse-mock/tertiary/moto-tail-wing.png'
import iconMotoWheel from '../assets/pallet-warehouse-mock/tertiary/moto-wheel.png'
import iconMotoAntifog from '../assets/pallet-warehouse-mock/tertiary/moto-antifog.png'
import iconMotoChildSeat from '../assets/pallet-warehouse-mock/tertiary/moto-child-seat.png'
import iconElecCharger from '../assets/pallet-warehouse-mock/tertiary/elec-charger.png'
import iconElecDvr from '../assets/pallet-warehouse-mock/tertiary/elec-dvr.png'
import iconElecGps from '../assets/pallet-warehouse-mock/tertiary/elec-gps.png'
import iconElecPlayer from '../assets/pallet-warehouse-mock/tertiary/elec-player.png'
import iconElecHud from '../assets/pallet-warehouse-mock/tertiary/elec-hud.png'
import iconElecReverse from '../assets/pallet-warehouse-mock/tertiary/elec-reverse.png'
import iconElecSpeaker from '../assets/pallet-warehouse-mock/tertiary/elec-speaker.png'
import iconElecSubwoofer from '../assets/pallet-warehouse-mock/tertiary/elec-subwoofer.png'
import iconElecAmplifier from '../assets/pallet-warehouse-mock/tertiary/elec-amplifier.png'
import iconElecPurifier from '../assets/pallet-warehouse-mock/tertiary/elec-purifier.png'
import iconElecHumidifier from '../assets/pallet-warehouse-mock/tertiary/elec-humidifier.png'
import iconElecFridge from '../assets/pallet-warehouse-mock/tertiary/elec-fridge.png'
import iconElecVacuum from '../assets/pallet-warehouse-mock/tertiary/elec-vacuum.png'
import iconElecInverter from '../assets/pallet-warehouse-mock/tertiary/elec-inverter.png'
import iconElecObd from '../assets/pallet-warehouse-mock/tertiary/elec-obd.png'
import iconElecAntenna from '../assets/pallet-warehouse-mock/tertiary/elec-antenna.png'
import iconElecIntercom from '../assets/pallet-warehouse-mock/tertiary/elec-intercom.png'
import iconElecOther from '../assets/pallet-warehouse-mock/tertiary/elec-other.png'
import iconLightHeadlight from '../assets/pallet-warehouse-mock/tertiary/light-headlight.png'
import iconLightTail from '../assets/pallet-warehouse-mock/tertiary/light-tail.png'
import iconLightFog from '../assets/pallet-warehouse-mock/tertiary/light-fog.png'
import iconLightDrl from '../assets/pallet-warehouse-mock/tertiary/light-drl.png'
import iconLightTurn from '../assets/pallet-warehouse-mock/tertiary/light-turn.png'
import iconLightBrake from '../assets/pallet-warehouse-mock/tertiary/light-brake.png'
import iconLightReverse from '../assets/pallet-warehouse-mock/tertiary/light-reverse.png'
import iconLightPlate from '../assets/pallet-warehouse-mock/tertiary/light-plate.png'
import iconLightDome from '../assets/pallet-warehouse-mock/tertiary/light-dome.png'
import iconLightReading from '../assets/pallet-warehouse-mock/tertiary/light-reading.png'
import iconLightTrunk from '../assets/pallet-warehouse-mock/tertiary/light-trunk.png'
import iconLightWelcome from '../assets/pallet-warehouse-mock/tertiary/light-welcome.png'
import iconLightBar from '../assets/pallet-warehouse-mock/tertiary/light-bar.png'
import iconLightLens from '../assets/pallet-warehouse-mock/tertiary/light-lens.png'
import iconLightBulb from '../assets/pallet-warehouse-mock/tertiary/light-bulb.png'
import iconLightOther from '../assets/pallet-warehouse-mock/tertiary/light-other.png'
import iconCareGun from '../assets/pallet-warehouse-mock/tertiary/care-gun.png'
import iconCareSponge from '../assets/pallet-warehouse-mock/tertiary/care-sponge.png'
import iconCareTowel from '../assets/pallet-warehouse-mock/tertiary/care-towel.png'
import iconCareWasher from '../assets/pallet-warehouse-mock/tertiary/care-washer.png'
import iconCareWax from '../assets/pallet-warehouse-mock/tertiary/care-wax.png'
import iconCareCoating from '../assets/pallet-warehouse-mock/tertiary/care-coating.png'
import iconCareInteriorCleaner from '../assets/pallet-warehouse-mock/tertiary/care-interior-cleaner.png'
import iconCareTireCleaner from '../assets/pallet-warehouse-mock/tertiary/care-tire-cleaner.png'
import iconCareEngineCleaner from '../assets/pallet-warehouse-mock/tertiary/care-engine-cleaner.png'
import iconCareGlassCleaner from '../assets/pallet-warehouse-mock/tertiary/care-glass-cleaner.png'
import iconCareFoam from '../assets/pallet-warehouse-mock/tertiary/care-foam.png'
import iconCareAcCleaner from '../assets/pallet-warehouse-mock/tertiary/care-ac-cleaner.png'
import iconCareOdor from '../assets/pallet-warehouse-mock/tertiary/care-odor.png'
import iconCarePolisher from '../assets/pallet-warehouse-mock/tertiary/care-polisher.png'
import iconCareWaxMachine from '../assets/pallet-warehouse-mock/tertiary/care-wax-machine.png'
import iconCareTireShine from '../assets/pallet-warehouse-mock/tertiary/care-tire-shine.png'
import iconCareRust from '../assets/pallet-warehouse-mock/tertiary/care-rust.png'
import iconCareOther from '../assets/pallet-warehouse-mock/tertiary/care-other.png'
import iconAvNav from '../assets/pallet-warehouse-mock/tertiary/av-nav.png'
import iconAvScreen from '../assets/pallet-warehouse-mock/tertiary/av-screen.png'
import iconAvCluster from '../assets/pallet-warehouse-mock/tertiary/av-cluster.png'
import iconAvHeadunit from '../assets/pallet-warehouse-mock/tertiary/av-headunit.png'
import iconAvSpeakerSet from '../assets/pallet-warehouse-mock/tertiary/av-speaker-set.png'
import iconAvAmp from '../assets/pallet-warehouse-mock/tertiary/av-amp.png'
import iconAvDsp from '../assets/pallet-warehouse-mock/tertiary/av-dsp.png'
import iconAvSubBox from '../assets/pallet-warehouse-mock/tertiary/av-sub-box.png'
import iconAvInstall from '../assets/pallet-warehouse-mock/tertiary/av-install.png'
import iconAvMap from '../assets/pallet-warehouse-mock/tertiary/av-map.png'
import iconAvMonitor from '../assets/pallet-warehouse-mock/tertiary/av-monitor.png'
import iconAv360 from '../assets/pallet-warehouse-mock/tertiary/av-360.png'
import iconAvCloudMirror from '../assets/pallet-warehouse-mock/tertiary/av-cloud-mirror.png'
import iconAvOther from '../assets/pallet-warehouse-mock/tertiary/av-other.png'
import iconSafetyExtinguisher from '../assets/pallet-warehouse-mock/tertiary/safety-extinguisher.png'
import iconSafetyTriangle from '../assets/pallet-warehouse-mock/tertiary/safety-triangle.png'
import iconSafetyVest from '../assets/pallet-warehouse-mock/tertiary/safety-vest.png'
import iconSafetyHammer from '../assets/pallet-warehouse-mock/tertiary/safety-hammer.png'
import iconSafetyTowRope from '../assets/pallet-warehouse-mock/tertiary/safety-tow-rope.png'
import iconSafetyCable from '../assets/pallet-warehouse-mock/tertiary/safety-cable.png'
import iconSafetyTireTool from '../assets/pallet-warehouse-mock/tertiary/safety-tire-tool.png'
import iconSafetyPump from '../assets/pallet-warehouse-mock/tertiary/safety-pump.png'
import iconSafetySpare from '../assets/pallet-warehouse-mock/tertiary/safety-spare.png'
import iconSafetyJumpStarter from '../assets/pallet-warehouse-mock/tertiary/safety-jump-starter.png'
import iconSafetyFirstaid from '../assets/pallet-warehouse-mock/tertiary/safety-firstaid.png'
import iconSafetyTape from '../assets/pallet-warehouse-mock/tertiary/safety-tape.png'
import iconSafetyChain from '../assets/pallet-warehouse-mock/tertiary/safety-chain.png'
import iconSafetyRoofBox from '../assets/pallet-warehouse-mock/tertiary/safety-roof-box.png'
import iconSafetyWaterTank from '../assets/pallet-warehouse-mock/tertiary/safety-water-tank.png'
import iconSafetyUmbrella from '../assets/pallet-warehouse-mock/tertiary/safety-umbrella.png'
import iconSafetyEscape from '../assets/pallet-warehouse-mock/tertiary/safety-escape.png'
import iconSafetyOther from '../assets/pallet-warehouse-mock/tertiary/safety-other.png'
import iconCushionFullMat from '../assets/pallet-warehouse-mock/tertiary/cushion-full-mat.png'
import iconCushionTrunkMat from '../assets/pallet-warehouse-mock/tertiary/cushion-trunk-mat.png'
import iconCushionSingleMat from '../assets/pallet-warehouse-mock/tertiary/cushion-single-mat.png'
import iconCushionCushion from '../assets/pallet-warehouse-mock/tertiary/cushion-cushion.png'
import iconCushionCover from '../assets/pallet-warehouse-mock/tertiary/cushion-cover.png'
import iconCushionMassage from '../assets/pallet-warehouse-mock/tertiary/cushion-massage.png'
import iconCushionSummer from '../assets/pallet-warehouse-mock/tertiary/cushion-summer.png'
import iconCushionWinter from '../assets/pallet-warehouse-mock/tertiary/cushion-winter.png'
import iconCushionLeather from '../assets/pallet-warehouse-mock/tertiary/cushion-leather.png'
import iconCushionFabric from '../assets/pallet-warehouse-mock/tertiary/cushion-fabric.png'
import iconCushionLeatherSet from '../assets/pallet-warehouse-mock/tertiary/cushion-leather-set.png'
import iconCushionSilkLoop from '../assets/pallet-warehouse-mock/tertiary/cushion-silk-loop.png'
import iconCushionRubber from '../assets/pallet-warehouse-mock/tertiary/cushion-rubber.png'
import iconCushionTrunkBox from '../assets/pallet-warehouse-mock/tertiary/cushion-trunk-box.png'
import iconCushionKids from '../assets/pallet-warehouse-mock/tertiary/cushion-kids.png'
import iconCushionOther from '../assets/pallet-warehouse-mock/tertiary/cushion-other.png'
import iconEvBicycle from '../assets/pallet-warehouse-mock/tertiary/ev-bicycle.png'
import iconEvMotorcycle from '../assets/pallet-warehouse-mock/tertiary/ev-motorcycle.png'
import iconEvTricycle from '../assets/pallet-warehouse-mock/tertiary/ev-tricycle.png'
import iconEvBalance from '../assets/pallet-warehouse-mock/tertiary/ev-balance.png'
import iconEvSkateboard from '../assets/pallet-warehouse-mock/tertiary/ev-skateboard.png'
import iconEvMobility from '../assets/pallet-warehouse-mock/tertiary/ev-mobility.png'
import iconEvSightseeing from '../assets/pallet-warehouse-mock/tertiary/ev-sightseeing.png'
import iconEvPatrol from '../assets/pallet-warehouse-mock/tertiary/ev-patrol.png'
import iconEvBattery from '../assets/pallet-warehouse-mock/tertiary/ev-battery.png'
import iconEvMotor from '../assets/pallet-warehouse-mock/tertiary/ev-motor.png'
import iconEvController from '../assets/pallet-warehouse-mock/tertiary/ev-controller.png'
import iconEvCharger from '../assets/pallet-warehouse-mock/tertiary/ev-charger.png'
import iconEvTire from '../assets/pallet-warehouse-mock/tertiary/ev-tire.png'
import iconEvLock from '../assets/pallet-warehouse-mock/tertiary/ev-lock.png'
import iconEvFrame from '../assets/pallet-warehouse-mock/tertiary/ev-frame.png'
import iconEvOther from '../assets/pallet-warehouse-mock/tertiary/ev-other.png'
import iconRefitAmbient from '../assets/pallet-warehouse-mock/tertiary/refit-ambient.png'
import iconRefitSeat from '../assets/pallet-warehouse-mock/tertiary/refit-seat.png'
import iconRefitWrap from '../assets/pallet-warehouse-mock/tertiary/refit-wrap.png'
import iconRefitCarbon from '../assets/pallet-warehouse-mock/tertiary/refit-carbon.png'
import iconRefitPedal from '../assets/pallet-warehouse-mock/tertiary/refit-pedal.png'
import iconRefitThrottle from '../assets/pallet-warehouse-mock/tertiary/refit-throttle.png'
import iconRefitExhaustTip from '../assets/pallet-warehouse-mock/tertiary/refit-exhaust-tip.png'
import iconRefitSoundproof from '../assets/pallet-warehouse-mock/tertiary/refit-soundproof.png'
import iconRefitFloorLeather from '../assets/pallet-warehouse-mock/tertiary/refit-floor-leather.png'
import iconRefitCeiling from '../assets/pallet-warehouse-mock/tertiary/refit-ceiling.png'
import iconRefitDoorLeather from '../assets/pallet-warehouse-mock/tertiary/refit-door-leather.png'
import iconRefitDash from '../assets/pallet-warehouse-mock/tertiary/refit-dash.png'
import iconRefitKnob from '../assets/pallet-warehouse-mock/tertiary/refit-knob.png'
import iconRefitHandbrake from '../assets/pallet-warehouse-mock/tertiary/refit-handbrake.png'
import iconRefitWheel from '../assets/pallet-warehouse-mock/tertiary/refit-wheel.png'
import iconRefitOther from '../assets/pallet-warehouse-mock/tertiary/refit-other.png'
import iconPartEngine from '../assets/pallet-warehouse-mock/tertiary/part-engine.png'
import iconPartBlock from '../assets/pallet-warehouse-mock/tertiary/part-block.png'
import iconPartHead from '../assets/pallet-warehouse-mock/tertiary/part-head.png'
import iconPartCrankshaft from '../assets/pallet-warehouse-mock/tertiary/part-crankshaft.png'
import iconPartCamshaft from '../assets/pallet-warehouse-mock/tertiary/part-camshaft.png'
import iconPartPiston from '../assets/pallet-warehouse-mock/tertiary/part-piston.png'
import iconPartTiming from '../assets/pallet-warehouse-mock/tertiary/part-timing.png'
import iconPartWaterPump from '../assets/pallet-warehouse-mock/tertiary/part-water-pump.png'
import iconPartOilPump from '../assets/pallet-warehouse-mock/tertiary/part-oil-pump.png'
import iconPartTurbo from '../assets/pallet-warehouse-mock/tertiary/part-turbo.png'
import iconPartIntercooler from '../assets/pallet-warehouse-mock/tertiary/part-intercooler.png'
import iconPartRadiator from '../assets/pallet-warehouse-mock/tertiary/part-radiator.png'
import iconPartFan from '../assets/pallet-warehouse-mock/tertiary/part-fan.png'
import iconPartClutch from '../assets/pallet-warehouse-mock/tertiary/part-clutch.png'
import iconPartGearbox from '../assets/pallet-warehouse-mock/tertiary/part-gearbox.png'
import iconPartDriveshaft from '../assets/pallet-warehouse-mock/tertiary/part-driveshaft.png'
import iconPartAxle from '../assets/pallet-warehouse-mock/tertiary/part-axle.png'
import iconPartJoint from '../assets/pallet-warehouse-mock/tertiary/part-joint.png'
import iconPartBrakePad from '../assets/pallet-warehouse-mock/tertiary/part-brake-pad.png'
import iconPartBrakeDisc from '../assets/pallet-warehouse-mock/tertiary/part-brake-disc.png'
import iconPartCaliper from '../assets/pallet-warehouse-mock/tertiary/part-caliper.png'
import iconPartShock from '../assets/pallet-warehouse-mock/tertiary/part-shock.png'
import iconPartArm from '../assets/pallet-warehouse-mock/tertiary/part-arm.png'
import iconPartOther from '../assets/pallet-warehouse-mock/tertiary/part-other.png'
import iconVehicleGasoline from '../assets/pallet-warehouse-mock/tertiary/vehicle-gasoline.png'
import iconVehicleDiesel from '../assets/pallet-warehouse-mock/tertiary/vehicle-diesel.png'
import iconVehicleEv from '../assets/pallet-warehouse-mock/tertiary/vehicle-ev.png'
import iconVehicleSuv from '../assets/pallet-warehouse-mock/tertiary/vehicle-suv.png'
import iconVehicleMpv from '../assets/pallet-warehouse-mock/tertiary/vehicle-mpv.png'
import iconVehiclePickup from '../assets/pallet-warehouse-mock/tertiary/vehicle-pickup.png'
import iconVehicleMiniTruck from '../assets/pallet-warehouse-mock/tertiary/vehicle-mini-truck.png'
import iconVehicleLightTruck from '../assets/pallet-warehouse-mock/tertiary/vehicle-light-truck.png'
import iconVehicleTruck from '../assets/pallet-warehouse-mock/tertiary/vehicle-truck.png'
import iconVehicleBus from '../assets/pallet-warehouse-mock/tertiary/vehicle-bus.png'
import iconVehicleSpecial from '../assets/pallet-warehouse-mock/tertiary/vehicle-special.png'
import iconVehicleOther from '../assets/pallet-warehouse-mock/tertiary/vehicle-other.png'
// 汽摩及配件三级类目新增图标（qm- 前缀）；语义命中者直接复用上方已有资产变量
import iconQmOilPump from '../assets/pallet-warehouse-mock/tertiary/qm-oil-pump.png'
import iconQmEngineOther from '../assets/pallet-warehouse-mock/tertiary/qm-engine-other.png'
import iconQmAirFilter from '../assets/pallet-warehouse-mock/tertiary/qm-air-filter.png'
import iconQmCylinder from '../assets/pallet-warehouse-mock/tertiary/qm-cylinder.png'
import iconQmOilFilter from '../assets/pallet-warehouse-mock/tertiary/qm-oil-filter.png'
import iconQmDieselFilter from '../assets/pallet-warehouse-mock/tertiary/qm-diesel-filter.png'
import iconQmValveParts from '../assets/pallet-warehouse-mock/tertiary/qm-valve-parts.png'
import iconQmStarter from '../assets/pallet-warehouse-mock/tertiary/qm-starter.png'
import iconQmCatalyst from '../assets/pallet-warehouse-mock/tertiary/qm-catalyst.png'
import iconQmTensioner from '../assets/pallet-warehouse-mock/tertiary/qm-tensioner.png'
import iconQmIntakePipe from '../assets/pallet-warehouse-mock/tertiary/qm-intake-pipe.png'
import iconQmCabinFilter from '../assets/pallet-warehouse-mock/tertiary/qm-cabin-filter.png'
import iconQmOilLine from '../assets/pallet-warehouse-mock/tertiary/qm-oil-line.png'
import iconQmIntakeManifold from '../assets/pallet-warehouse-mock/tertiary/qm-intake-manifold.png'
import iconQmEvGrip from '../assets/pallet-warehouse-mock/tertiary/qm-ev-grip.png'
import iconQmEvMeter from '../assets/pallet-warehouse-mock/tertiary/qm-ev-meter.png'
import iconQmCluster from '../assets/pallet-warehouse-mock/tertiary/qm-cluster.png'
import iconQmSpeedometer from '../assets/pallet-warehouse-mock/tertiary/qm-speedometer.png'
import iconQmTachometer from '../assets/pallet-warehouse-mock/tertiary/qm-tachometer.png'
import iconQmFuelGauge from '../assets/pallet-warehouse-mock/tertiary/qm-fuel-gauge.png'
import iconQmTempGauge from '../assets/pallet-warehouse-mock/tertiary/qm-temp-gauge.png'
import iconQmOilGauge from '../assets/pallet-warehouse-mock/tertiary/qm-oil-gauge.png'
import iconQmVoltGauge from '../assets/pallet-warehouse-mock/tertiary/qm-volt-gauge.png'
import iconQmMeterOther from '../assets/pallet-warehouse-mock/tertiary/qm-meter-other.png'
import iconQmAlternator from '../assets/pallet-warehouse-mock/tertiary/qm-alternator.png'
import iconQmIgnitionCoil from '../assets/pallet-warehouse-mock/tertiary/qm-ignition-coil.png'
import iconQmSparkPlug from '../assets/pallet-warehouse-mock/tertiary/qm-spark-plug.png'
import iconQmGlowPlug from '../assets/pallet-warehouse-mock/tertiary/qm-glow-plug.png'
import iconQmIgnitionModule from '../assets/pallet-warehouse-mock/tertiary/qm-ignition-module.png'
import iconQmDistributor from '../assets/pallet-warehouse-mock/tertiary/qm-distributor.png'
import iconQmPowerOther from '../assets/pallet-warehouse-mock/tertiary/qm-power-other.png'
import iconQmThermostat from '../assets/pallet-warehouse-mock/tertiary/qm-thermostat.png'
import iconQmRadiatorHose from '../assets/pallet-warehouse-mock/tertiary/qm-radiator-hose.png'
import iconQmExpansionTank from '../assets/pallet-warehouse-mock/tertiary/qm-expansion-tank.png'
import iconQmCoolingOther from '../assets/pallet-warehouse-mock/tertiary/qm-cooling-other.png'
import iconQmWheelHub from '../assets/pallet-warehouse-mock/tertiary/qm-wheel-hub.png'
import iconQmSwayBar from '../assets/pallet-warehouse-mock/tertiary/qm-sway-bar.png'
import iconQmBallJoint from '../assets/pallet-warehouse-mock/tertiary/qm-ball-joint.png'
import iconQmRunningOther from '../assets/pallet-warehouse-mock/tertiary/qm-running-other.png'
import iconQmBrakeMaster from '../assets/pallet-warehouse-mock/tertiary/qm-brake-master.png'
import iconQmBrakeWheel from '../assets/pallet-warehouse-mock/tertiary/qm-brake-wheel.png'
import iconQmBrakeHose from '../assets/pallet-warehouse-mock/tertiary/qm-brake-hose.png'
import iconQmAbs from '../assets/pallet-warehouse-mock/tertiary/qm-abs.png'
import iconQmParkingBrake from '../assets/pallet-warehouse-mock/tertiary/qm-parking-brake.png'
import iconQmBrakeBooster from '../assets/pallet-warehouse-mock/tertiary/qm-brake-booster.png'
import iconQmBrakeOther from '../assets/pallet-warehouse-mock/tertiary/qm-brake-other.png'
import iconQmCvJoint from '../assets/pallet-warehouse-mock/tertiary/qm-cv-joint.png'
import iconQmFlywheel from '../assets/pallet-warehouse-mock/tertiary/qm-flywheel.png'
import iconQmShiftCable from '../assets/pallet-warehouse-mock/tertiary/qm-shift-cable.png'
import iconQmTorqueConverter from '../assets/pallet-warehouse-mock/tertiary/qm-torque-converter.png'
import iconQmSynchronizer from '../assets/pallet-warehouse-mock/tertiary/qm-synchronizer.png'
import iconQmChainBelt from '../assets/pallet-warehouse-mock/tertiary/qm-chain-belt.png'
import iconQmTransOther from '../assets/pallet-warehouse-mock/tertiary/qm-trans-other.png'
import iconQmSteeringRack from '../assets/pallet-warehouse-mock/tertiary/qm-steering-rack.png'
import iconQmTieRod from '../assets/pallet-warehouse-mock/tertiary/qm-tie-rod.png'
import iconQmSteeringColumn from '../assets/pallet-warehouse-mock/tertiary/qm-steering-column.png'
import iconQmSteeringPump from '../assets/pallet-warehouse-mock/tertiary/qm-steering-pump.png'
import iconQmSteeringDamper from '../assets/pallet-warehouse-mock/tertiary/qm-steering-damper.png'
import iconQmKnuckle from '../assets/pallet-warehouse-mock/tertiary/qm-knuckle.png'
import iconQmSteeringOther from '../assets/pallet-warehouse-mock/tertiary/qm-steering-other.png'
import iconQmCtrlBrushless from '../assets/pallet-warehouse-mock/tertiary/qm-ctrl-brushless.png'
import iconQmCtrlBrushed from '../assets/pallet-warehouse-mock/tertiary/qm-ctrl-brushed.png'
import iconQmCtrlHarness from '../assets/pallet-warehouse-mock/tertiary/qm-ctrl-harness.png'
import iconQmCtrlHeatsink from '../assets/pallet-warehouse-mock/tertiary/qm-ctrl-heatsink.png'
import iconQmCtrlOther from '../assets/pallet-warehouse-mock/tertiary/qm-ctrl-other.png'
import iconQmMotoWhole from '../assets/pallet-warehouse-mock/tertiary/qm-moto-whole.png'
import iconQmCoach from '../assets/pallet-warehouse-mock/tertiary/qm-coach.png'
import iconQmSemitrailer from '../assets/pallet-warehouse-mock/tertiary/qm-semitrailer.png'
import iconQmDumpTruck from '../assets/pallet-warehouse-mock/tertiary/qm-dump-truck.png'
import iconQmMfgLine from '../assets/pallet-warehouse-mock/tertiary/qm-mfg-line.png'
import iconQmMfgMachine from '../assets/pallet-warehouse-mock/tertiary/qm-mfg-machine.png'
import iconQmMfgWeld from '../assets/pallet-warehouse-mock/tertiary/qm-mfg-weld.png'
import iconQmMfgPaint from '../assets/pallet-warehouse-mock/tertiary/qm-mfg-paint.png'
import iconQmMfgTest from '../assets/pallet-warehouse-mock/tertiary/qm-mfg-test.png'
import iconQmMfgMold from '../assets/pallet-warehouse-mock/tertiary/qm-mfg-mold.png'
import iconQmMfgTire from '../assets/pallet-warehouse-mock/tertiary/qm-mfg-tire.png'
import iconQmMfgOther from '../assets/pallet-warehouse-mock/tertiary/qm-mfg-other.png'
import iconQmRepairLift from '../assets/pallet-warehouse-mock/tertiary/qm-repair-lift.png'
import iconQmRepairBalancer from '../assets/pallet-warehouse-mock/tertiary/qm-repair-balancer.png'
import iconQmRepairChanger from '../assets/pallet-warehouse-mock/tertiary/qm-repair-changer.png'
import iconQmRepairAligner from '../assets/pallet-warehouse-mock/tertiary/qm-repair-aligner.png'
import iconQmRepairBody from '../assets/pallet-warehouse-mock/tertiary/qm-repair-body.png'
import iconQmRepairPaintBooth from '../assets/pallet-warehouse-mock/tertiary/qm-repair-paint-booth.png'
import iconQmRepairTools from '../assets/pallet-warehouse-mock/tertiary/qm-repair-tools.png'
import iconQmRepairJack from '../assets/pallet-warehouse-mock/tertiary/qm-repair-jack.png'
import iconQmRepairOther from '../assets/pallet-warehouse-mock/tertiary/qm-repair-other.png'
import iconQmSpecialFire from '../assets/pallet-warehouse-mock/tertiary/qm-special-fire.png'
import iconQmSpecialAmbulance from '../assets/pallet-warehouse-mock/tertiary/qm-special-ambulance.png'
import iconQmSpecialPolice from '../assets/pallet-warehouse-mock/tertiary/qm-special-police.png'
import iconQmSpecialEngineering from '../assets/pallet-warehouse-mock/tertiary/qm-special-engineering.png'
import iconQmSpecialSanitation from '../assets/pallet-warehouse-mock/tertiary/qm-special-sanitation.png'
import iconQmSpecialRefrigerated from '../assets/pallet-warehouse-mock/tertiary/qm-special-refrigerated.png'
import iconQmSpecialOther from '../assets/pallet-warehouse-mock/tertiary/qm-special-other.png'
import iconQmPassengerCoupe from '../assets/pallet-warehouse-mock/tertiary/qm-passenger-coupe.png'
import iconQmFuelDispenser from '../assets/pallet-warehouse-mock/tertiary/qm-fuel-dispenser.png'
import iconQmFuelTank from '../assets/pallet-warehouse-mock/tertiary/qm-fuel-tank.png'
import iconQmFuelPump from '../assets/pallet-warehouse-mock/tertiary/qm-fuel-pump.png'
import iconQmFuelNozzle from '../assets/pallet-warehouse-mock/tertiary/qm-fuel-nozzle.png'
import iconQmFuelGaugeLevel from '../assets/pallet-warehouse-mock/tertiary/qm-fuel-gauge-level.png'
import iconQmFuelVapor from '../assets/pallet-warehouse-mock/tertiary/qm-fuel-vapor.png'
import iconQmFuelSign from '../assets/pallet-warehouse-mock/tertiary/qm-fuel-sign.png'
import iconQmFuelOther from '../assets/pallet-warehouse-mock/tertiary/qm-fuel-other.png'
import iconQmCoopProject from '../assets/pallet-warehouse-mock/tertiary/qm-coop-project.png'
import iconQmCoopTech from '../assets/pallet-warehouse-mock/tertiary/qm-coop-tech.png'
import iconQmCoopJoint from '../assets/pallet-warehouse-mock/tertiary/qm-coop-joint.png'
import iconQmCoopOther from '../assets/pallet-warehouse-mock/tertiary/qm-coop-other.png'
import iconQmParkBarrier from '../assets/pallet-warehouse-mock/tertiary/qm-park-barrier.png'
import iconQmParkLock from '../assets/pallet-warehouse-mock/tertiary/qm-park-lock.png'
import iconQmParkGuide from '../assets/pallet-warehouse-mock/tertiary/qm-park-guide.png'
import iconQmParkCharger from '../assets/pallet-warehouse-mock/tertiary/qm-park-charger.png'
import iconQmParkShade from '../assets/pallet-warehouse-mock/tertiary/qm-park-shade.png'
import iconQmParkMark from '../assets/pallet-warehouse-mock/tertiary/qm-park-mark.png'
import iconQmParkCamera from '../assets/pallet-warehouse-mock/tertiary/qm-park-camera.png'
import iconQmParkOther from '../assets/pallet-warehouse-mock/tertiary/qm-park-other.png'
import iconQmAgent from '../assets/pallet-warehouse-mock/tertiary/qm-agent.png'
import iconQmAgentRegion from '../assets/pallet-warehouse-mock/tertiary/qm-agent-region.png'
import iconQmAgentExclusive from '../assets/pallet-warehouse-mock/tertiary/qm-agent-exclusive.png'
import iconQmAgentOther from '../assets/pallet-warehouse-mock/tertiary/qm-agent-other.png'
// 居家日用品三级类目新增图标（home- 前缀）；语义命中者复用已有资产变量（雨伞/烟灰缸/温度计/毛巾）
import iconHomeOther from '../assets/pallet-warehouse-mock/tertiary/home-other.png'
import iconHomeFridgeMagnet from '../assets/pallet-warehouse-mock/tertiary/home-fridge-magnet.png'
import iconHomeSewing from '../assets/pallet-warehouse-mock/tertiary/home-sewing.png'
import iconHomeDisposableOther from '../assets/pallet-warehouse-mock/tertiary/home-disposable-other.png'
import iconHomeEyeMask from '../assets/pallet-warehouse-mock/tertiary/home-eye-mask.png'
import iconHomeDisposableUnderwear from '../assets/pallet-warehouse-mock/tertiary/home-disposable-underwear.png'
import iconHomeFan from '../assets/pallet-warehouse-mock/tertiary/home-fan.png'
import iconHomeScissors from '../assets/pallet-warehouse-mock/tertiary/home-scissors.png'
import iconHomeShoeBrush from '../assets/pallet-warehouse-mock/tertiary/home-shoe-brush.png'
import iconHomeDisposableSheet from '../assets/pallet-warehouse-mock/tertiary/home-disposable-sheet.png'
import iconHomeLadder from '../assets/pallet-warehouse-mock/tertiary/home-ladder.png'
import iconHomeAntiSnore from '../assets/pallet-warehouse-mock/tertiary/home-anti-snore.png'
import iconHomeOvenGloves from '../assets/pallet-warehouse-mock/tertiary/home-oven-gloves.png'
import iconHomeBreastPump from '../assets/pallet-warehouse-mock/tertiary/home-breast-pump.png'
import iconHomeShoeCovers from '../assets/pallet-warehouse-mock/tertiary/home-shoe-covers.png'
import iconHomeHandheldFan from '../assets/pallet-warehouse-mock/tertiary/home-handheld-fan.png'
import iconHomeIcePad from '../assets/pallet-warehouse-mock/tertiary/home-ice-pad.png'
import iconHomeRaincoat from '../assets/pallet-warehouse-mock/tertiary/home-raincoat.png'
import iconHomeSunUmbrella from '../assets/pallet-warehouse-mock/tertiary/home-sun-umbrella.png'
import iconHomeWindshieldBoard from '../assets/pallet-warehouse-mock/tertiary/home-windshield-board.png'
import iconHomeCanopy from '../assets/pallet-warehouse-mock/tertiary/home-canopy.png'
import iconHomeUmbrellaParts from '../assets/pallet-warehouse-mock/tertiary/home-umbrella-parts.png'
import iconHomeRainCover from '../assets/pallet-warehouse-mock/tertiary/home-rain-cover.png'
import iconHomeRainOther from '../assets/pallet-warehouse-mock/tertiary/home-rain-other.png'
import iconHomeLighter from '../assets/pallet-warehouse-mock/tertiary/home-lighter.png'
import iconHomeCigaretteCase from '../assets/pallet-warehouse-mock/tertiary/home-cigarette-case.png'
import iconHomeCigaretteHolder from '../assets/pallet-warehouse-mock/tertiary/home-cigarette-holder.png'
import iconHomeTorchLighter from '../assets/pallet-warehouse-mock/tertiary/home-torch-lighter.png'
import iconHomeFlint from '../assets/pallet-warehouse-mock/tertiary/home-flint.png'
import iconHomeQuitSmoking from '../assets/pallet-warehouse-mock/tertiary/home-quit-smoking.png'
import iconHomeSmokeOther from '../assets/pallet-warehouse-mock/tertiary/home-smoke-other.png'
import iconHomeHotelAmenity from '../assets/pallet-warehouse-mock/tertiary/home-hotel-amenity.png'
import iconHomeHotelSlippers from '../assets/pallet-warehouse-mock/tertiary/home-hotel-slippers.png'
import iconHomeHotelBedding from '../assets/pallet-warehouse-mock/tertiary/home-hotel-bedding.png'
import iconHomeHotelCup from '../assets/pallet-warehouse-mock/tertiary/home-hotel-cup.png'
import iconHomeHotelSign from '../assets/pallet-warehouse-mock/tertiary/home-hotel-sign.png'
import iconHomeHotelAppliance from '../assets/pallet-warehouse-mock/tertiary/home-hotel-appliance.png'
import iconHomeHotelOther from '../assets/pallet-warehouse-mock/tertiary/home-hotel-other.png'
import iconHomeKitchenScale from '../assets/pallet-warehouse-mock/tertiary/home-kitchen-scale.png'
import iconHomeBodyScale from '../assets/pallet-warehouse-mock/tertiary/home-body-scale.png'
import iconHomeLuggageScale from '../assets/pallet-warehouse-mock/tertiary/home-luggage-scale.png'
import iconHomePocketScale from '../assets/pallet-warehouse-mock/tertiary/home-pocket-scale.png'
import iconHomePlatformScale from '../assets/pallet-warehouse-mock/tertiary/home-platform-scale.png'
import iconHomeHangingScale from '../assets/pallet-warehouse-mock/tertiary/home-hanging-scale.png'
import iconHomeFloorScale from '../assets/pallet-warehouse-mock/tertiary/home-floor-scale.png'
import iconHomeScaleOther from '../assets/pallet-warehouse-mock/tertiary/home-scale-other.png'
import iconHomeHeatPatch from '../assets/pallet-warehouse-mock/tertiary/home-heat-patch.png'
import iconHomeHotWaterBag from '../assets/pallet-warehouse-mock/tertiary/home-hot-water-bag.png'
import iconHomeHandStove from '../assets/pallet-warehouse-mock/tertiary/home-hand-stove.png'
import iconHomeHandWarmer from '../assets/pallet-warehouse-mock/tertiary/home-hand-warmer.png'
import iconHomeElectricBlanket from '../assets/pallet-warehouse-mock/tertiary/home-electric-blanket.png'
import iconHomeWarmEarmuff from '../assets/pallet-warehouse-mock/tertiary/home-warm-earmuff.png'
import iconHomeFootWarmer from '../assets/pallet-warehouse-mock/tertiary/home-foot-warmer.png'
import iconHomeWarmOther from '../assets/pallet-warehouse-mock/tertiary/home-warm-other.png'
import iconHomeUsbFan from '../assets/pallet-warehouse-mock/tertiary/home-usb-fan.png'
import iconHomeUsbHumidifier from '../assets/pallet-warehouse-mock/tertiary/home-usb-humidifier.png'
import iconHomeUsbCoaster from '../assets/pallet-warehouse-mock/tertiary/home-usb-coaster.png'
import iconHomeUsbNightLight from '../assets/pallet-warehouse-mock/tertiary/home-usb-night-light.png'
import iconHomeUsbVacuum from '../assets/pallet-warehouse-mock/tertiary/home-usb-vacuum.png'
import iconHomeUsbMassager from '../assets/pallet-warehouse-mock/tertiary/home-usb-massager.png'
import iconHomeUsbCooler from '../assets/pallet-warehouse-mock/tertiary/home-usb-cooler.png'
import iconHomeUsbOther from '../assets/pallet-warehouse-mock/tertiary/home-usb-other.png'
import iconHomeStorageBox from '../assets/pallet-warehouse-mock/tertiary/home-storage-box.png'
import iconHomeStorageBasket from '../assets/pallet-warehouse-mock/tertiary/home-storage-basket.png'
import iconHomeStorageBag from '../assets/pallet-warehouse-mock/tertiary/home-storage-bag.png'
import iconHomeStorageShelf from '../assets/pallet-warehouse-mock/tertiary/home-storage-shelf.png'
import iconHomeClosetDivider from '../assets/pallet-warehouse-mock/tertiary/home-closet-divider.png'
import iconHomeDeskOrganizer from '../assets/pallet-warehouse-mock/tertiary/home-desk-organizer.png'
import iconHomeShoeBox from '../assets/pallet-warehouse-mock/tertiary/home-shoe-box.png'
import iconHomeKitchenRack from '../assets/pallet-warehouse-mock/tertiary/home-kitchen-rack.png'
import iconHomeBathroomStorage from '../assets/pallet-warehouse-mock/tertiary/home-bathroom-storage.png'
import iconHomeStorageOther from '../assets/pallet-warehouse-mock/tertiary/home-storage-other.png'
import iconHomeMop from '../assets/pallet-warehouse-mock/tertiary/home-mop.png'
import iconHomeBroom from '../assets/pallet-warehouse-mock/tertiary/home-broom.png'
import iconHomeCloth from '../assets/pallet-warehouse-mock/tertiary/home-cloth.png'
import iconHomeCleanBrush from '../assets/pallet-warehouse-mock/tertiary/home-clean-brush.png'
import iconHomeGlassSqueegee from '../assets/pallet-warehouse-mock/tertiary/home-glass-squeegee.png'
import iconHomeToiletBrush from '../assets/pallet-warehouse-mock/tertiary/home-toilet-brush.png'
import iconHomeTrashBin from '../assets/pallet-warehouse-mock/tertiary/home-trash-bin.png'
import iconHomeCleanGloves from '../assets/pallet-warehouse-mock/tertiary/home-clean-gloves.png'
import iconHomeDuster from '../assets/pallet-warehouse-mock/tertiary/home-duster.png'
import iconHomeCleanOther from '../assets/pallet-warehouse-mock/tertiary/home-clean-other.png'
import iconHomeLunchBox from '../assets/pallet-warehouse-mock/tertiary/home-lunch-box.png'
import iconHomeCuttingBoard from '../assets/pallet-warehouse-mock/tertiary/home-cutting-board.png'
import iconHomeKnifeSet from '../assets/pallet-warehouse-mock/tertiary/home-knife-set.png'
import iconHomeCookware from '../assets/pallet-warehouse-mock/tertiary/home-cookware.png'
import iconHomeTableware from '../assets/pallet-warehouse-mock/tertiary/home-tableware.png'
import iconHomeWaterBottle from '../assets/pallet-warehouse-mock/tertiary/home-water-bottle.png'
import iconHomeKitchenShelf from '../assets/pallet-warehouse-mock/tertiary/home-kitchen-shelf.png'
import iconHomeBakeware from '../assets/pallet-warehouse-mock/tertiary/home-bakeware.png'
import iconHomeDisposableTableware from '../assets/pallet-warehouse-mock/tertiary/home-disposable-tableware.png'
import iconHomeKitchenOther from '../assets/pallet-warehouse-mock/tertiary/home-kitchen-other.png'
// 五金、工具三级类目新增图标（hw- 前缀）；语义命中者复用已有资产变量（含 hw-misc 共用“其他X”类）
import iconHwMisc from '../assets/pallet-warehouse-mock/tertiary/hw-misc.png'
import iconHwScrew from '../assets/pallet-warehouse-mock/tertiary/hw-screw.png'
import iconHwNut from '../assets/pallet-warehouse-mock/tertiary/hw-nut.png'
import iconHwBolt from '../assets/pallet-warehouse-mock/tertiary/hw-bolt.png'
import iconHwWasher from '../assets/pallet-warehouse-mock/tertiary/hw-washer.png'
import iconHwRivet from '../assets/pallet-warehouse-mock/tertiary/hw-rivet.png'
import iconHwPinKey from '../assets/pallet-warehouse-mock/tertiary/hw-pin-key.png'
import iconHwFastenerOther from '../assets/pallet-warehouse-mock/tertiary/hw-fastener-other.png'
import iconHwStandoff from '../assets/pallet-warehouse-mock/tertiary/hw-standoff.png'
import iconHwComboConnect from '../assets/pallet-warehouse-mock/tertiary/hw-combo-connect.png'
import iconHwCirclip from '../assets/pallet-warehouse-mock/tertiary/hw-circlip.png'
import iconHwAdNail from '../assets/pallet-warehouse-mock/tertiary/hw-ad-nail.png'
import iconHwPowerAccessory from '../assets/pallet-warehouse-mock/tertiary/hw-power-accessory.png'
import iconHwDrill from '../assets/pallet-warehouse-mock/tertiary/hw-drill.png'
import iconHwElectricScrewdriver from '../assets/pallet-warehouse-mock/tertiary/hw-electric-screwdriver.png'
import iconHwBlower from '../assets/pallet-warehouse-mock/tertiary/hw-blower.png'
import iconHwGrinder from '../assets/pallet-warehouse-mock/tertiary/hw-grinder.png'
import iconHwHeatGun from '../assets/pallet-warehouse-mock/tertiary/hw-heat-gun.png'
import iconHwGardenScissors from '../assets/pallet-warehouse-mock/tertiary/hw-garden-scissors.png'
import iconHwPruningSaw from '../assets/pallet-warehouse-mock/tertiary/hw-pruning-saw.png'
import iconHwWatering from '../assets/pallet-warehouse-mock/tertiary/hw-watering.png'
import iconHwGardenSprayer from '../assets/pallet-warehouse-mock/tertiary/hw-garden-sprayer.png'
import iconHwMowerParts from '../assets/pallet-warehouse-mock/tertiary/hw-mower-parts.png'
import iconHwGreenhouse from '../assets/pallet-warehouse-mock/tertiary/hw-greenhouse.png'
import iconHwGardenHand from '../assets/pallet-warehouse-mock/tertiary/hw-garden-hand.png'
import iconHwBall from '../assets/pallet-warehouse-mock/tertiary/hw-ball.png'
import iconHwHandle from '../assets/pallet-warehouse-mock/tertiary/hw-handle.png'
import iconHwHook from '../assets/pallet-warehouse-mock/tertiary/hw-hook.png'
import iconHwBuckle from '../assets/pallet-warehouse-mock/tertiary/hw-buckle.png'
import iconHwChain from '../assets/pallet-warehouse-mock/tertiary/hw-chain.png'
import iconHwCaster from '../assets/pallet-warehouse-mock/tertiary/hw-caster.png'
import iconHwStepLadder from '../assets/pallet-warehouse-mock/tertiary/hw-step-ladder.png'
import iconHwGreaseGun from '../assets/pallet-warehouse-mock/tertiary/hw-grease-gun.png'
import iconHwOilGun from '../assets/pallet-warehouse-mock/tertiary/hw-oil-gun.png'
import iconHwRepairKit from '../assets/pallet-warehouse-mock/tertiary/hw-repair-kit.png'
import iconHwPuller from '../assets/pallet-warehouse-mock/tertiary/hw-puller.png'
import iconHwTapDie from '../assets/pallet-warehouse-mock/tertiary/hw-tap-die.png'
import iconHwInspectMirror from '../assets/pallet-warehouse-mock/tertiary/hw-inspect-mirror.png'
import iconHwMaintenanceSet from '../assets/pallet-warehouse-mock/tertiary/hw-maintenance-set.png'
import iconHwGrindingWheel from '../assets/pallet-warehouse-mock/tertiary/hw-grinding-wheel.png'
import iconHwCuttingDisc from '../assets/pallet-warehouse-mock/tertiary/hw-cutting-disc.png'
import iconHwSandpaper from '../assets/pallet-warehouse-mock/tertiary/hw-sandpaper.png'
import iconHwAbrasiveBelt from '../assets/pallet-warehouse-mock/tertiary/hw-abrasive-belt.png'
import iconHwFlapDisc from '../assets/pallet-warehouse-mock/tertiary/hw-flap-disc.png'
import iconHwPolishWheel from '../assets/pallet-warehouse-mock/tertiary/hw-polish-wheel.png'
import iconHwDiamondTools from '../assets/pallet-warehouse-mock/tertiary/hw-diamond-tools.png'
import iconHwToolSetHome from '../assets/pallet-warehouse-mock/tertiary/hw-tool-set-home.png'
import iconHwToolSetAuto from '../assets/pallet-warehouse-mock/tertiary/hw-tool-set-auto.png'
import iconHwSocketSet from '../assets/pallet-warehouse-mock/tertiary/hw-socket-set.png'
import iconHwScrewdriverSet from '../assets/pallet-warehouse-mock/tertiary/hw-screwdriver-set.png'
import iconHwPlierSet from '../assets/pallet-warehouse-mock/tertiary/hw-plier-set.png'
import iconHwWrenchSet from '../assets/pallet-warehouse-mock/tertiary/hw-wrench-set.png'
import iconHwToolbox from '../assets/pallet-warehouse-mock/tertiary/hw-toolbox.png'
import iconHwWrenchAdjustable from '../assets/pallet-warehouse-mock/tertiary/hw-wrench-adjustable.png'
import iconHwWrenchDouble from '../assets/pallet-warehouse-mock/tertiary/hw-wrench-double.png'
import iconHwWrenchSocket from '../assets/pallet-warehouse-mock/tertiary/hw-wrench-socket.png'
import iconHwWrenchTorque from '../assets/pallet-warehouse-mock/tertiary/hw-wrench-torque.png'
import iconHwWrenchHex from '../assets/pallet-warehouse-mock/tertiary/hw-wrench-hex.png'
import iconHwWrenchPipe from '../assets/pallet-warehouse-mock/tertiary/hw-wrench-pipe.png'
import iconHwWrenchSpecial from '../assets/pallet-warehouse-mock/tertiary/hw-wrench-special.png'
import iconHwHammer from '../assets/pallet-warehouse-mock/tertiary/hw-hammer.png'
import iconHwAxe from '../assets/pallet-warehouse-mock/tertiary/hw-axe.png'
import iconHwScrewdriver from '../assets/pallet-warehouse-mock/tertiary/hw-screwdriver.png'
import iconHwFile from '../assets/pallet-warehouse-mock/tertiary/hw-file.png'
import iconHwHandsaw from '../assets/pallet-warehouse-mock/tertiary/hw-handsaw.png'
import iconHwChisel from '../assets/pallet-warehouse-mock/tertiary/hw-chisel.png'
import iconHwHandSpecial from '../assets/pallet-warehouse-mock/tertiary/hw-hand-special.png'
import iconHwDrillBit from '../assets/pallet-warehouse-mock/tertiary/hw-drill-bit.png'
import iconHwGrindingHead from '../assets/pallet-warehouse-mock/tertiary/hw-grinding-head.png'
import iconHwCutterBlade from '../assets/pallet-warehouse-mock/tertiary/hw-cutter-blade.png'
import iconHwCarbonBrush from '../assets/pallet-warehouse-mock/tertiary/hw-carbon-brush.png'
import iconHwEngravingBit from '../assets/pallet-warehouse-mock/tertiary/hw-engraving-bit.png'
import iconHwPlierWire from '../assets/pallet-warehouse-mock/tertiary/hw-plier-wire.png'
import iconHwPlierNeedle from '../assets/pallet-warehouse-mock/tertiary/hw-plier-needle.png'
import iconHwPlierDiagonal from '../assets/pallet-warehouse-mock/tertiary/hw-plier-diagonal.png'
import iconHwPlierFlat from '../assets/pallet-warehouse-mock/tertiary/hw-plier-flat.png'
import iconHwPlierLock from '../assets/pallet-warehouse-mock/tertiary/hw-plier-lock.png'
import iconHwPlierPipe from '../assets/pallet-warehouse-mock/tertiary/hw-plier-pipe.png'
import iconHwPlierCirclip from '../assets/pallet-warehouse-mock/tertiary/hw-plier-circlip.png'
import iconHwPumpCentrifugal from '../assets/pallet-warehouse-mock/tertiary/hw-pump-centrifugal.png'
import iconHwPumpSelfPriming from '../assets/pallet-warehouse-mock/tertiary/hw-pump-self-priming.png'
import iconHwPumpSubmersible from '../assets/pallet-warehouse-mock/tertiary/hw-pump-submersible.png'
import iconHwPumpGear from '../assets/pallet-warehouse-mock/tertiary/hw-pump-gear.png'
import iconHwPumpDiaphragm from '../assets/pallet-warehouse-mock/tertiary/hw-pump-diaphragm.png'
import iconHwPumpVacuum from '../assets/pallet-warehouse-mock/tertiary/hw-pump-vacuum.png'
import iconHwPumpMagnetic from '../assets/pallet-warehouse-mock/tertiary/hw-pump-magnetic.png'
import iconHwRack from '../assets/pallet-warehouse-mock/tertiary/hw-rack.png'
import iconHwShelf from '../assets/pallet-warehouse-mock/tertiary/hw-shelf.png'
import iconHwToolCabinet from '../assets/pallet-warehouse-mock/tertiary/hw-tool-cabinet.png'
import iconHwStorageBench from '../assets/pallet-warehouse-mock/tertiary/hw-storage-bench.png'
import iconHwPallet from '../assets/pallet-warehouse-mock/tertiary/hw-pallet.png'
import iconHwStackingRack from '../assets/pallet-warehouse-mock/tertiary/hw-stacking-rack.png'
import iconHwKnifeFruit from '../assets/pallet-warehouse-mock/tertiary/hw-knife-fruit.png'
import iconHwKnifePocket from '../assets/pallet-warehouse-mock/tertiary/hw-knife-pocket.png'
import iconHwKnifeUtility from '../assets/pallet-warehouse-mock/tertiary/hw-knife-utility.png'
import iconHwKnifePruning from '../assets/pallet-warehouse-mock/tertiary/hw-knife-pruning.png'
import iconHwKnifeCraft from '../assets/pallet-warehouse-mock/tertiary/hw-knife-craft.png'
import iconHwBrushPaint from '../assets/pallet-warehouse-mock/tertiary/hw-brush-paint.png'
import iconHwBrushWire from '../assets/pallet-warehouse-mock/tertiary/hw-brush-wire.png'
import iconHwBrushClean from '../assets/pallet-warehouse-mock/tertiary/hw-brush-clean.png'
import iconHwBrushDust from '../assets/pallet-warehouse-mock/tertiary/hw-brush-dust.png'
import iconHwBrushDetail from '../assets/pallet-warehouse-mock/tertiary/hw-brush-detail.png'
import iconHwBrushSet from '../assets/pallet-warehouse-mock/tertiary/hw-brush-set.png'
import iconHwBrushRoller from '../assets/pallet-warehouse-mock/tertiary/hw-brush-roller.png'
import iconHwHandTruck from '../assets/pallet-warehouse-mock/tertiary/hw-hand-truck.png'
import iconHwPlatformTruck from '../assets/pallet-warehouse-mock/tertiary/hw-platform-truck.png'
import iconHwForklift from '../assets/pallet-warehouse-mock/tertiary/hw-forklift.png'
import iconHwHydraulicTruck from '../assets/pallet-warehouse-mock/tertiary/hw-hydraulic-truck.png'
import iconHwCart from '../assets/pallet-warehouse-mock/tertiary/hw-cart.png'
import iconHwHoist from '../assets/pallet-warehouse-mock/tertiary/hw-hoist.png'
import iconHwPlatformScissor from '../assets/pallet-warehouse-mock/tertiary/hw-platform-scissor.png'
import iconHwSdPhillips from '../assets/pallet-warehouse-mock/tertiary/hw-sd-phillips.png'
import iconHwSdFlat from '../assets/pallet-warehouse-mock/tertiary/hw-sd-flat.png'
import iconHwSdPrecision from '../assets/pallet-warehouse-mock/tertiary/hw-sd-precision.png'
import iconHwSdRatchet from '../assets/pallet-warehouse-mock/tertiary/hw-sd-ratchet.png'
import iconHwSdInsulated from '../assets/pallet-warehouse-mock/tertiary/hw-sd-insulated.png'
import iconHwSdMulti from '../assets/pallet-warehouse-mock/tertiary/hw-sd-multi.png'
import iconHwSdBits from '../assets/pallet-warehouse-mock/tertiary/hw-sd-bits.png'
import iconHwValveBall from '../assets/pallet-warehouse-mock/tertiary/hw-valve-ball.png'
import iconHwValveGate from '../assets/pallet-warehouse-mock/tertiary/hw-valve-gate.png'
import iconHwValveStop from '../assets/pallet-warehouse-mock/tertiary/hw-valve-stop.png'
import iconHwValveCheck from '../assets/pallet-warehouse-mock/tertiary/hw-valve-check.png'
import iconHwValveButterfly from '../assets/pallet-warehouse-mock/tertiary/hw-valve-butterfly.png'
import iconHwValveSafety from '../assets/pallet-warehouse-mock/tertiary/hw-valve-safety.png'
import iconHwValveSolenoid from '../assets/pallet-warehouse-mock/tertiary/hw-valve-solenoid.png'
import iconHwWelderElectric from '../assets/pallet-warehouse-mock/tertiary/hw-welder-electric.png'
import iconHwWelderGas from '../assets/pallet-warehouse-mock/tertiary/hw-welder-gas.png'
import iconHwPlasmaCutter from '../assets/pallet-warehouse-mock/tertiary/hw-plasma-cutter.png'
import iconHwWeldingTorch from '../assets/pallet-warehouse-mock/tertiary/hw-welding-torch.png'
import iconHwWeldingMask from '../assets/pallet-warehouse-mock/tertiary/hw-welding-mask.png'
import iconHwWeldingRod from '../assets/pallet-warehouse-mock/tertiary/hw-welding-rod.png'
import iconHwGasRegulator from '../assets/pallet-warehouse-mock/tertiary/hw-gas-regulator.png'
import iconHwPlasticWelder from '../assets/pallet-warehouse-mock/tertiary/hw-plastic-welder.png'
import iconHwPlasticExtruder from '../assets/pallet-warehouse-mock/tertiary/hw-plastic-extruder.png'
import iconHwInjectionMachine from '../assets/pallet-warehouse-mock/tertiary/hw-injection-machine.png'
import iconHwBlowMolding from '../assets/pallet-warehouse-mock/tertiary/hw-blow-molding.png'
import iconHwPlasticCrusher from '../assets/pallet-warehouse-mock/tertiary/hw-plastic-crusher.png'
import iconHwPlasticMixer from '../assets/pallet-warehouse-mock/tertiary/hw-plastic-mixer.png'
import iconHwThermoforming from '../assets/pallet-warehouse-mock/tertiary/hw-thermoforming.png'
import iconHwBenchVise from '../assets/pallet-warehouse-mock/tertiary/hw-bench-vise.png'
import iconHwBenchFile from '../assets/pallet-warehouse-mock/tertiary/hw-bench-file.png'
import iconHwScraper from '../assets/pallet-warehouse-mock/tertiary/hw-scraper.png'
import iconHwScribe from '../assets/pallet-warehouse-mock/tertiary/hw-scribe.png'
import iconHwBenchDrillParts from '../assets/pallet-warehouse-mock/tertiary/hw-bench-drill-parts.png'
import iconHwLayoutTool from '../assets/pallet-warehouse-mock/tertiary/hw-layout-tool.png'
import iconHwBenchSet from '../assets/pallet-warehouse-mock/tertiary/hw-bench-set.png'
import iconHwPipeSteel from '../assets/pallet-warehouse-mock/tertiary/hw-pipe-steel.png'
import iconHwPipePvc from '../assets/pallet-warehouse-mock/tertiary/hw-pipe-pvc.png'
import iconHwPipeFitting from '../assets/pallet-warehouse-mock/tertiary/hw-pipe-fitting.png'
import iconHwFlange from '../assets/pallet-warehouse-mock/tertiary/hw-flange.png'
import iconHwHose from '../assets/pallet-warehouse-mock/tertiary/hw-hose.png'
import iconHwQuickConnector from '../assets/pallet-warehouse-mock/tertiary/hw-quick-connector.png'
import iconHwPipeClamp from '../assets/pallet-warehouse-mock/tertiary/hw-pipe-clamp.png'
import iconHwKeychain from '../assets/pallet-warehouse-mock/tertiary/hw-keychain.png'
import iconHwBadge from '../assets/pallet-warehouse-mock/tertiary/hw-badge.png'
import iconHwBookmark from '../assets/pallet-warehouse-mock/tertiary/hw-bookmark.png'
import iconHwJewelryParts from '../assets/pallet-warehouse-mock/tertiary/hw-jewelry-parts.png'
import iconHwOrnament from '../assets/pallet-warehouse-mock/tertiary/hw-ornament.png'
import iconHwCoin from '../assets/pallet-warehouse-mock/tertiary/hw-coin.png'
import iconHwCraftParts from '../assets/pallet-warehouse-mock/tertiary/hw-craft-parts.png'
import iconHwBenchstationHeavy from '../assets/pallet-warehouse-mock/tertiary/hw-benchstation-heavy.png'
import iconHwBenchstationAntistatic from '../assets/pallet-warehouse-mock/tertiary/hw-benchstation-antistatic.png'
import iconHwBenchstationTool from '../assets/pallet-warehouse-mock/tertiary/hw-benchstation-tool.png'
import iconHwBenchstationInspect from '../assets/pallet-warehouse-mock/tertiary/hw-benchstation-inspect.png'
import iconHwBenchstationWeld from '../assets/pallet-warehouse-mock/tertiary/hw-benchstation-weld.png'
import iconHwBenchstationParts from '../assets/pallet-warehouse-mock/tertiary/hw-benchstation-parts.png'
import iconHwBenchstationCustom from '../assets/pallet-warehouse-mock/tertiary/hw-benchstation-custom.png'
import iconHwModel3d from '../assets/pallet-warehouse-mock/tertiary/hw-model-3d.png'
import iconHwModelCnc from '../assets/pallet-warehouse-mock/tertiary/hw-model-cnc.png'
import iconHwModelSilicone from '../assets/pallet-warehouse-mock/tertiary/hw-model-silicone.png'
import iconHwModelAppearance from '../assets/pallet-warehouse-mock/tertiary/hw-model-appearance.png'
import iconHwModelStructural from '../assets/pallet-warehouse-mock/tertiary/hw-model-structural.png'
import iconHwModelFixture from '../assets/pallet-warehouse-mock/tertiary/hw-model-fixture.png'
import iconHwModelMaterial from '../assets/pallet-warehouse-mock/tertiary/hw-model-material.png'
import iconHwGearboxGear from '../assets/pallet-warehouse-mock/tertiary/hw-gearbox-gear.png'
import iconHwGearboxWorm from '../assets/pallet-warehouse-mock/tertiary/hw-gearbox-worm.png'
import iconHwGearboxCycloid from '../assets/pallet-warehouse-mock/tertiary/hw-gearbox-cycloid.png'
import iconHwGearboxPlanetary from '../assets/pallet-warehouse-mock/tertiary/hw-gearbox-planetary.png'
import iconHwGearboxHarmonic from '../assets/pallet-warehouse-mock/tertiary/hw-gearbox-harmonic.png'
import iconHwGearboxBox from '../assets/pallet-warehouse-mock/tertiary/hw-gearbox-box.png'
import iconHwGearboxParts from '../assets/pallet-warehouse-mock/tertiary/hw-gearbox-parts.png'
import iconHw3dFdm from '../assets/pallet-warehouse-mock/tertiary/hw-3d-fdm.png'
import iconHw3dResin from '../assets/pallet-warehouse-mock/tertiary/hw-3d-resin.png'
import iconHw3dIndustrial from '../assets/pallet-warehouse-mock/tertiary/hw-3d-industrial.png'
import iconHw3dParts from '../assets/pallet-warehouse-mock/tertiary/hw-3d-parts.png'
import iconHw3dConsumable from '../assets/pallet-warehouse-mock/tertiary/hw-3d-consumable.png'
import iconHw3dScanner from '../assets/pallet-warehouse-mock/tertiary/hw-3d-scanner.png'
import iconHwMoldGuide from '../assets/pallet-warehouse-mock/tertiary/hw-mold-guide.png'
import iconHwMoldEjector from '../assets/pallet-warehouse-mock/tertiary/hw-mold-ejector.png'
import iconHwMoldBushing from '../assets/pallet-warehouse-mock/tertiary/hw-mold-bushing.png'
import iconHwMoldSpring from '../assets/pallet-warehouse-mock/tertiary/hw-mold-spring.png'
import iconHwMoldLocating from '../assets/pallet-warehouse-mock/tertiary/hw-mold-locating.png'
import iconHwMoldCooling from '../assets/pallet-warehouse-mock/tertiary/hw-mold-cooling.png'
import iconHwMoldInsert from '../assets/pallet-warehouse-mock/tertiary/hw-mold-insert.png'
import iconHwClutchEm from '../assets/pallet-warehouse-mock/tertiary/hw-clutch-em.png'
import iconHwClutchPowder from '../assets/pallet-warehouse-mock/tertiary/hw-clutch-powder.png'
import iconHwClutchFriction from '../assets/pallet-warehouse-mock/tertiary/hw-clutch-friction.png'
import iconHwClutchHydraulic from '../assets/pallet-warehouse-mock/tertiary/hw-clutch-hydraulic.png'
import iconHwClutchPneumatic from '../assets/pallet-warehouse-mock/tertiary/hw-clutch-pneumatic.png'
import iconHwClutchDisc from '../assets/pallet-warehouse-mock/tertiary/hw-clutch-disc.png'
import iconHwClutchBearing from '../assets/pallet-warehouse-mock/tertiary/hw-clutch-bearing.png'
import iconHwCopperTool from '../assets/pallet-warehouse-mock/tertiary/hw-copper-tool.png'
import iconHwExpContainer from '../assets/pallet-warehouse-mock/tertiary/hw-exp-container.png'
import iconHwCaliper from '../assets/pallet-warehouse-mock/tertiary/hw-caliper.png'
import iconHwMicrometer from '../assets/pallet-warehouse-mock/tertiary/hw-micrometer.png'
import iconHwDialIndicator from '../assets/pallet-warehouse-mock/tertiary/hw-dial-indicator.png'
import iconHwHeightGauge from '../assets/pallet-warehouse-mock/tertiary/hw-height-gauge.png'
import iconHwAngleRuler from '../assets/pallet-warehouse-mock/tertiary/hw-angle-ruler.png'
import iconHwRoughness from '../assets/pallet-warehouse-mock/tertiary/hw-roughness.png'
import iconHwMeasureSet from '../assets/pallet-warehouse-mock/tertiary/hw-measure-set.png'
import iconHwCutterCarbide from '../assets/pallet-warehouse-mock/tertiary/hw-cutter-carbide.png'
import iconHwCutterHss from '../assets/pallet-warehouse-mock/tertiary/hw-cutter-hss.png'
import iconHwCutterIndexable from '../assets/pallet-warehouse-mock/tertiary/hw-cutter-indexable.png'
import iconHwReamer from '../assets/pallet-warehouse-mock/tertiary/hw-reamer.png'
import iconHwBoring from '../assets/pallet-warehouse-mock/tertiary/hw-boring.png'
import iconHwMilling from '../assets/pallet-warehouse-mock/tertiary/hw-milling.png'
import iconHwSolderIron from '../assets/pallet-warehouse-mock/tertiary/hw-solder-iron.png'
import iconHwSolderWire from '../assets/pallet-warehouse-mock/tertiary/hw-solder-wire.png'
import iconHwFlux from '../assets/pallet-warehouse-mock/tertiary/hw-flux.png'
import iconHwDesolder from '../assets/pallet-warehouse-mock/tertiary/hw-desolder.png'
import iconHwReworkStation from '../assets/pallet-warehouse-mock/tertiary/hw-rework-station.png'
import iconHwGlueGun from '../assets/pallet-warehouse-mock/tertiary/hw-glue-gun.png'
import iconHwSolderParts from '../assets/pallet-warehouse-mock/tertiary/hw-solder-parts.png'
import iconHwTeachingModel from '../assets/pallet-warehouse-mock/tertiary/hw-teaching-model.png'
import iconHwOfficeParts from '../assets/pallet-warehouse-mock/tertiary/hw-office-parts.png'
import iconHwWhiteboardParts from '../assets/pallet-warehouse-mock/tertiary/hw-whiteboard-parts.png'
import iconHwCabinetLock from '../assets/pallet-warehouse-mock/tertiary/hw-cabinet-lock.png'
import iconHwDeskHardware from '../assets/pallet-warehouse-mock/tertiary/hw-desk-hardware.png'
import iconHwMeetingHardware from '../assets/pallet-warehouse-mock/tertiary/hw-meeting-hardware.png'
import iconHwBrakeEm from '../assets/pallet-warehouse-mock/tertiary/hw-brake-em.png'
import iconHwBrakePowder from '../assets/pallet-warehouse-mock/tertiary/hw-brake-powder.png'
import iconHwBrakePneumatic from '../assets/pallet-warehouse-mock/tertiary/hw-brake-pneumatic.png'
import iconHwBrakeHydraulic from '../assets/pallet-warehouse-mock/tertiary/hw-brake-hydraulic.png'
import iconHwBrakeMotor from '../assets/pallet-warehouse-mock/tertiary/hw-brake-motor.png'
import iconHwPlatformAlu from '../assets/pallet-warehouse-mock/tertiary/hw-platform-alu.png'
import iconHwPlatformVehicle from '../assets/pallet-warehouse-mock/tertiary/hw-platform-vehicle.png'
import iconHwScaffold from '../assets/pallet-warehouse-mock/tertiary/hw-scaffold.png'
import iconHwPlatformFolding from '../assets/pallet-warehouse-mock/tertiary/hw-platform-folding.png'
import iconHwPlatformInsulated from '../assets/pallet-warehouse-mock/tertiary/hw-platform-insulated.png'
import iconHwPlatformParts from '../assets/pallet-warehouse-mock/tertiary/hw-platform-parts.png'
import iconHwElderGrabBar from '../assets/pallet-warehouse-mock/tertiary/hw-elder-grab-bar.png'
import iconHwElderMagnifier from '../assets/pallet-warehouse-mock/tertiary/hw-elder-magnifier.png'
// 办公、文化三级类目新增图标（office- 前缀）；语义命中者复用已有资产变量（含 office-misc 共用“其他X”类）
import iconOfficeMisc from '../assets/pallet-warehouse-mock/tertiary/office-misc.png'
import iconOfficeResinCraft from '../assets/pallet-warehouse-mock/tertiary/office-resin-craft.png'
import iconOfficeMetalCraft from '../assets/pallet-warehouse-mock/tertiary/office-metal-craft.png'
import iconOfficeGlassCraft from '../assets/pallet-warehouse-mock/tertiary/office-glass-craft.png'
import iconOfficeCeramicCraft from '../assets/pallet-warehouse-mock/tertiary/office-ceramic-craft.png'
import iconOfficeWoodCraft from '../assets/pallet-warehouse-mock/tertiary/office-wood-craft.png'
import iconOfficeBalloon from '../assets/pallet-warehouse-mock/tertiary/office-balloon.png'
import iconOfficeRibbon from '../assets/pallet-warehouse-mock/tertiary/office-ribbon.png'
import iconOfficeFestivalLight from '../assets/pallet-warehouse-mock/tertiary/office-festival-light.png'
import iconOfficeDecorSet from '../assets/pallet-warehouse-mock/tertiary/office-decor-set.png'
import iconOfficeBackdrop from '../assets/pallet-warehouse-mock/tertiary/office-backdrop.png'
import iconOfficeGelPen from '../assets/pallet-warehouse-mock/tertiary/office-gel-pen.png'
import iconOfficeBallpoint from '../assets/pallet-warehouse-mock/tertiary/office-ballpoint.png'
import iconOfficeFountainPen from '../assets/pallet-warehouse-mock/tertiary/office-fountain-pen.png'
import iconOfficePencil from '../assets/pallet-warehouse-mock/tertiary/office-pencil.png'
import iconOfficeMarker from '../assets/pallet-warehouse-mock/tertiary/office-marker.png'
import iconOfficeEraser from '../assets/pallet-warehouse-mock/tertiary/office-eraser.png'
import iconOfficeRuler from '../assets/pallet-warehouse-mock/tertiary/office-ruler.png'
import iconOfficePencilCase from '../assets/pallet-warehouse-mock/tertiary/office-pencil-case.png'
import iconOfficeSharpener from '../assets/pallet-warehouse-mock/tertiary/office-sharpener.png'
import iconOfficeStationerySet from '../assets/pallet-warehouse-mock/tertiary/office-stationery-set.png'
import iconOfficeArtificialFlower from '../assets/pallet-warehouse-mock/tertiary/office-artificial-flower.png'
import iconOfficeArtificialPlant from '../assets/pallet-warehouse-mock/tertiary/office-artificial-plant.png'
import iconOfficeArtificialLawn from '../assets/pallet-warehouse-mock/tertiary/office-artificial-lawn.png'
import iconOfficeArtificialTree from '../assets/pallet-warehouse-mock/tertiary/office-artificial-tree.png'
import iconOfficeArtificialFruit from '../assets/pallet-warehouse-mock/tertiary/office-artificial-fruit.png'
import iconOfficeKeyBag from '../assets/pallet-warehouse-mock/tertiary/office-key-bag.png'
import iconOfficeKeyRing from '../assets/pallet-warehouse-mock/tertiary/office-key-ring.png'
import iconOfficeCardHolder from '../assets/pallet-warehouse-mock/tertiary/office-card-holder.png'
import iconOfficeKeyChain from '../assets/pallet-warehouse-mock/tertiary/office-key-chain.png'
import iconOfficeNotebook from '../assets/pallet-warehouse-mock/tertiary/office-notebook.png'
import iconOfficeMemoPad from '../assets/pallet-warehouse-mock/tertiary/office-memo-pad.png'
import iconOfficeSpiralBook from '../assets/pallet-warehouse-mock/tertiary/office-spiral-book.png'
import iconOfficeLooseLeaf from '../assets/pallet-warehouse-mock/tertiary/office-loose-leaf.png'
import iconOfficeStickyNote from '../assets/pallet-warehouse-mock/tertiary/office-sticky-note.png'
import iconOfficeChristmasTree from '../assets/pallet-warehouse-mock/tertiary/office-christmas-tree.png'
import iconOfficeChristmasBall from '../assets/pallet-warehouse-mock/tertiary/office-christmas-ball.png'
import iconOfficeChristmasHat from '../assets/pallet-warehouse-mock/tertiary/office-christmas-hat.png'
import iconOfficeChristmasLight from '../assets/pallet-warehouse-mock/tertiary/office-christmas-light.png'
import iconOfficeChristmasSock from '../assets/pallet-warehouse-mock/tertiary/office-christmas-sock.png'
import iconOfficePaint from '../assets/pallet-warehouse-mock/tertiary/office-paint.png'
import iconOfficePaintBrush from '../assets/pallet-warehouse-mock/tertiary/office-paint-brush.png'
import iconOfficeEasel from '../assets/pallet-warehouse-mock/tertiary/office-easel.png'
import iconOfficeXuanPaper from '../assets/pallet-warehouse-mock/tertiary/office-xuan-paper.png'
import iconOfficePalette from '../assets/pallet-warehouse-mock/tertiary/office-palette.png'
import iconOfficeFileRack from '../assets/pallet-warehouse-mock/tertiary/office-file-rack.png'
import iconOfficePenHolder from '../assets/pallet-warehouse-mock/tertiary/office-pen-holder.png'
import iconOfficeDocumentFile from '../assets/pallet-warehouse-mock/tertiary/office-document-file.png'
import iconOfficeDisplayRack from '../assets/pallet-warehouse-mock/tertiary/office-display-rack.png'
import iconOfficeDisplayBoard from '../assets/pallet-warehouse-mock/tertiary/office-display-board.png'
import iconOfficeLightBox from '../assets/pallet-warehouse-mock/tertiary/office-light-box.png'
import iconOfficeRollBanner from '../assets/pallet-warehouse-mock/tertiary/office-roll-banner.png'
import iconOfficeWindowProp from '../assets/pallet-warehouse-mock/tertiary/office-window-prop.png'
import iconOfficeStapler from '../assets/pallet-warehouse-mock/tertiary/office-stapler.png'
import iconOfficeHolePunch from '../assets/pallet-warehouse-mock/tertiary/office-hole-punch.png'
import iconOfficeGlue from '../assets/pallet-warehouse-mock/tertiary/office-glue.png'
import iconOfficeDeskMat from '../assets/pallet-warehouse-mock/tertiary/office-desk-mat.png'
import iconOfficeLantern from '../assets/pallet-warehouse-mock/tertiary/office-lantern.png'
import iconOfficeBunting from '../assets/pallet-warehouse-mock/tertiary/office-bunting.png'
import iconOfficeFestivalGiftBox from '../assets/pallet-warehouse-mock/tertiary/office-festival-gift-box.png'
import iconOfficePartySupply from '../assets/pallet-warehouse-mock/tertiary/office-party-supply.png'
import iconOfficeCeremonyProp from '../assets/pallet-warehouse-mock/tertiary/office-ceremony-prop.png'
import iconOfficePrinter from '../assets/pallet-warehouse-mock/tertiary/office-printer.png'
import iconOfficeShredder from '../assets/pallet-warehouse-mock/tertiary/office-shredder.png'
import iconOfficeAttendance from '../assets/pallet-warehouse-mock/tertiary/office-attendance.png'
import iconOfficeLaminator from '../assets/pallet-warehouse-mock/tertiary/office-laminator.png'
import iconOfficeMoneyCounter from '../assets/pallet-warehouse-mock/tertiary/office-money-counter.png'
import iconOfficeGiftSet from '../assets/pallet-warehouse-mock/tertiary/office-gift-set.png'
import iconOfficeTrophy from '../assets/pallet-warehouse-mock/tertiary/office-trophy.png'
import iconOfficeBusinessNotebook from '../assets/pallet-warehouse-mock/tertiary/office-business-notebook.png'
import iconOfficeGiftUsb from '../assets/pallet-warehouse-mock/tertiary/office-gift-usb.png'
import iconOfficeGiftPen from '../assets/pallet-warehouse-mock/tertiary/office-gift-pen.png'
import iconOfficeInvitation from '../assets/pallet-warehouse-mock/tertiary/office-invitation.png'
import iconOfficeWeddingDecor from '../assets/pallet-warehouse-mock/tertiary/office-wedding-decor.png'
import iconOfficeCandyBox from '../assets/pallet-warehouse-mock/tertiary/office-candy-box.png'
import iconOfficeWeddingAccessory from '../assets/pallet-warehouse-mock/tertiary/office-wedding-accessory.png'
import iconOfficeRedEnvelope from '../assets/pallet-warehouse-mock/tertiary/office-red-envelope.png'
import iconOfficePlannerBook from '../assets/pallet-warehouse-mock/tertiary/office-planner-book.png'
import iconOfficeWashiTape from '../assets/pallet-warehouse-mock/tertiary/office-washi-tape.png'
import iconOfficeSticker from '../assets/pallet-warehouse-mock/tertiary/office-sticker.png'
import iconOfficePlannerPen from '../assets/pallet-warehouse-mock/tertiary/office-planner-pen.png'
import iconOfficePlannerSet from '../assets/pallet-warehouse-mock/tertiary/office-planner-set.png'
import iconOfficeGuitar from '../assets/pallet-warehouse-mock/tertiary/office-guitar.png'
import iconOfficeHarmonica from '../assets/pallet-warehouse-mock/tertiary/office-harmonica.png'
import iconOfficeUkulele from '../assets/pallet-warehouse-mock/tertiary/office-ukulele.png'
import iconOfficeDrum from '../assets/pallet-warehouse-mock/tertiary/office-drum.png'
import iconOfficeFluteCn from '../assets/pallet-warehouse-mock/tertiary/office-flute-cn.png'
import iconOfficeSeal from '../assets/pallet-warehouse-mock/tertiary/office-seal.png'
import iconOfficeInkPad from '../assets/pallet-warehouse-mock/tertiary/office-ink-pad.png'
import iconOfficeFlag from '../assets/pallet-warehouse-mock/tertiary/office-flag.png'
import iconOfficeIdHolder from '../assets/pallet-warehouse-mock/tertiary/office-id-holder.png'
import iconOfficeSealBox from '../assets/pallet-warehouse-mock/tertiary/office-seal-box.png'
import iconOfficeCreativeOrnament from '../assets/pallet-warehouse-mock/tertiary/office-creative-ornament.png'
import iconOfficeCreativeCup from '../assets/pallet-warehouse-mock/tertiary/office-creative-cup.png'
import iconOfficeCreativeLight from '../assets/pallet-warehouse-mock/tertiary/office-creative-light.png'
import iconOfficeCreativeToy from '../assets/pallet-warehouse-mock/tertiary/office-creative-toy.png'
import iconOfficeCustomGift from '../assets/pallet-warehouse-mock/tertiary/office-custom-gift.png'
import iconOfficeResinOrnament from '../assets/pallet-warehouse-mock/tertiary/office-resin-ornament.png'
import iconOfficeMetalOrnament from '../assets/pallet-warehouse-mock/tertiary/office-metal-ornament.png'
import iconOfficeWoodOrnament from '../assets/pallet-warehouse-mock/tertiary/office-wood-ornament.png'
import iconOfficeCeramicOrnament from '../assets/pallet-warehouse-mock/tertiary/office-ceramic-ornament.png'
import iconOfficeCrystalOrnament from '../assets/pallet-warehouse-mock/tertiary/office-crystal-ornament.png'
import iconOfficeCopyPaper from '../assets/pallet-warehouse-mock/tertiary/office-copy-paper.png'
import iconOfficePrintPaper from '../assets/pallet-warehouse-mock/tertiary/office-print-paper.png'
import iconOfficeFaxPaper from '../assets/pallet-warehouse-mock/tertiary/office-fax-paper.png'
import iconOfficeCashPaper from '../assets/pallet-warehouse-mock/tertiary/office-cash-paper.png'
import iconOfficePhotoPaper from '../assets/pallet-warehouse-mock/tertiary/office-photo-paper.png'
import iconOfficeCulturalCreative from '../assets/pallet-warehouse-mock/tertiary/office-cultural-creative.png'
import iconOfficePainting from '../assets/pallet-warehouse-mock/tertiary/office-painting.png'
import iconOfficeIncenseWay from '../assets/pallet-warehouse-mock/tertiary/office-incense-way.png'
import iconOfficeTeaAccessory from '../assets/pallet-warehouse-mock/tertiary/office-tea-accessory.png'
import iconOfficeFigure from '../assets/pallet-warehouse-mock/tertiary/office-figure.png'
import iconOfficeAnimeBadge from '../assets/pallet-warehouse-mock/tertiary/office-anime-badge.png'
import iconOfficePoster from '../assets/pallet-warehouse-mock/tertiary/office-poster.png'
import iconOfficeCosProp from '../assets/pallet-warehouse-mock/tertiary/office-cos-prop.png'
import iconOfficeCharm from '../assets/pallet-warehouse-mock/tertiary/office-charm.png'
import iconOfficeCalculator from '../assets/pallet-warehouse-mock/tertiary/office-calculator.png'
import iconOfficeAccountBook from '../assets/pallet-warehouse-mock/tertiary/office-account-book.png'
import iconOfficeReceiptClip from '../assets/pallet-warehouse-mock/tertiary/office-receipt-clip.png'
import iconOfficeAbacus from '../assets/pallet-warehouse-mock/tertiary/office-abacus.png'
import iconOfficeFinanceSeal from '../assets/pallet-warehouse-mock/tertiary/office-finance-seal.png'
import iconOfficePrayerBeads from '../assets/pallet-warehouse-mock/tertiary/office-prayer-beads.png'
import iconOfficeIncenseBurner from '../assets/pallet-warehouse-mock/tertiary/office-incense-burner.png'
import iconOfficeReligiousPendant from '../assets/pallet-warehouse-mock/tertiary/office-religious-pendant.png'
import iconOfficeOfferingVessel from '../assets/pallet-warehouse-mock/tertiary/office-offering-vessel.png'
import iconOfficeReligiousGarment from '../assets/pallet-warehouse-mock/tertiary/office-religious-garment.png'
import iconOfficeInkCartridge from '../assets/pallet-warehouse-mock/tertiary/office-ink-cartridge.png'
import iconOfficeTonerCartridge from '../assets/pallet-warehouse-mock/tertiary/office-toner-cartridge.png'
import iconOfficeTonerPowder from '../assets/pallet-warehouse-mock/tertiary/office-toner-powder.png'
import iconOfficePrinterRibbon from '../assets/pallet-warehouse-mock/tertiary/office-printer-ribbon.png'
import iconOfficeBook from '../assets/pallet-warehouse-mock/tertiary/office-book.png'
import iconOfficeMagazine from '../assets/pallet-warehouse-mock/tertiary/office-magazine.png'
import iconOfficeTeachingAid from '../assets/pallet-warehouse-mock/tertiary/office-teaching-aid.png'
import iconOfficeMap from '../assets/pallet-warehouse-mock/tertiary/office-map.png'
import iconOfficeAvProduct from '../assets/pallet-warehouse-mock/tertiary/office-av-product.png'
import iconOfficeMagicProp from '../assets/pallet-warehouse-mock/tertiary/office-magic-prop.png'
import iconOfficePerformanceCostume from '../assets/pallet-warehouse-mock/tertiary/office-performance-costume.png'
import iconOfficePartyMask from '../assets/pallet-warehouse-mock/tertiary/office-party-mask.png'
import iconOfficeGlowStick from '../assets/pallet-warehouse-mock/tertiary/office-glow-stick.png'
import iconOfficeStageProp from '../assets/pallet-warehouse-mock/tertiary/office-stage-prop.png'
import iconOfficeCandle from '../assets/pallet-warehouse-mock/tertiary/office-candle.png'
import iconOfficePaperRitual from '../assets/pallet-warehouse-mock/tertiary/office-paper-ritual.png'
import iconOfficeFuneralGarment from '../assets/pallet-warehouse-mock/tertiary/office-funeral-garment.png'
import iconOfficeUrn from '../assets/pallet-warehouse-mock/tertiary/office-urn.png'
import iconOfficeRitualSet from '../assets/pallet-warehouse-mock/tertiary/office-ritual-set.png'
import iconOfficeMicroscope from '../assets/pallet-warehouse-mock/tertiary/office-microscope.png'
import iconOfficeGlobe from '../assets/pallet-warehouse-mock/tertiary/office-globe.png'
import iconOfficeTeachingChart from '../assets/pallet-warehouse-mock/tertiary/office-teaching-chart.png'
import iconOfficeLabEquipment from '../assets/pallet-warehouse-mock/tertiary/office-lab-equipment.png'
import iconOfficePaperCutting from '../assets/pallet-warehouse-mock/tertiary/office-paper-cutting.png'
import iconOfficeEmbroidery from '../assets/pallet-warehouse-mock/tertiary/office-embroidery.png'
import iconOfficeClayFigure from '../assets/pallet-warehouse-mock/tertiary/office-clay-figure.png'
import iconOfficeDoughFigure from '../assets/pallet-warehouse-mock/tertiary/office-dough-figure.png'
import iconOfficeWeaving from '../assets/pallet-warehouse-mock/tertiary/office-weaving.png'
import iconOfficeBeads from '../assets/pallet-warehouse-mock/tertiary/office-beads.png'
import iconOfficeTassel from '../assets/pallet-warehouse-mock/tertiary/office-tassel.png'
import iconOfficeChinaKnot from '../assets/pallet-warehouse-mock/tertiary/office-china-knot.png'
import iconOfficeCraftCord from '../assets/pallet-warehouse-mock/tertiary/office-craft-cord.png'
import iconOfficeBaseStand from '../assets/pallet-warehouse-mock/tertiary/office-base-stand.png'
import iconOfficeStamp from '../assets/pallet-warehouse-mock/tertiary/office-stamp.png'
import iconOfficeCoinAlbum from '../assets/pallet-warehouse-mock/tertiary/office-coin-album.png'
import iconOfficeCollectionCard from '../assets/pallet-warehouse-mock/tertiary/office-collection-card.png'
import iconOfficeGradingCase from '../assets/pallet-warehouse-mock/tertiary/office-grading-case.png'
import iconOfficeBeaker from '../assets/pallet-warehouse-mock/tertiary/office-beaker.png'
import iconOfficeTestTube from '../assets/pallet-warehouse-mock/tertiary/office-test-tube.png'
import iconOfficeCylinder from '../assets/pallet-warehouse-mock/tertiary/office-cylinder.png'
import iconOfficeDropper from '../assets/pallet-warehouse-mock/tertiary/office-dropper.png'
import iconOfficeLabRack from '../assets/pallet-warehouse-mock/tertiary/office-lab-rack.png'
import iconOfficePorcelainCollect from '../assets/pallet-warehouse-mock/tertiary/office-porcelain-collect.png'
import iconOfficeJadeCollect from '../assets/pallet-warehouse-mock/tertiary/office-jade-collect.png'
import iconOfficeBronzeCollect from '../assets/pallet-warehouse-mock/tertiary/office-bronze-collect.png'
import iconOfficePaintingCollect from '../assets/pallet-warehouse-mock/tertiary/office-painting-collect.png'
import iconOfficeCollectBox from '../assets/pallet-warehouse-mock/tertiary/office-collect-box.png'
import iconOfficeStudyMachine from '../assets/pallet-warehouse-mock/tertiary/office-study-machine.png'
import iconOfficeReadingPen from '../assets/pallet-warehouse-mock/tertiary/office-reading-pen.png'
import iconOfficeEDictionary from '../assets/pallet-warehouse-mock/tertiary/office-e-dictionary.png'
import iconOfficeRepeater from '../assets/pallet-warehouse-mock/tertiary/office-repeater.png'
import iconOfficeEarlyEducation from '../assets/pallet-warehouse-mock/tertiary/office-early-education.png'
import iconOfficeCouplet from '../assets/pallet-warehouse-mock/tertiary/office-couplet.png'
import iconOfficeWindowFlower from '../assets/pallet-warehouse-mock/tertiary/office-window-flower.png'
import iconOfficeLaiSee from '../assets/pallet-warehouse-mock/tertiary/office-lai-see.png'
import iconOfficeLanternCny from '../assets/pallet-warehouse-mock/tertiary/office-lantern-cny.png'
import iconOfficeNewYearPainting from '../assets/pallet-warehouse-mock/tertiary/office-new-year-painting.png'
import iconOfficeStrings from '../assets/pallet-warehouse-mock/tertiary/office-strings.png'
import iconOfficePick from '../assets/pallet-warehouse-mock/tertiary/office-pick.png'
import iconOfficeInstrumentBag from '../assets/pallet-warehouse-mock/tertiary/office-instrument-bag.png'
import iconOfficeTuner from '../assets/pallet-warehouse-mock/tertiary/office-tuner.png'
import iconOfficeStandStrap from '../assets/pallet-warehouse-mock/tertiary/office-stand-strap.png'
import iconOfficeViolin from '../assets/pallet-warehouse-mock/tertiary/office-violin.png'
import iconOfficePiano from '../assets/pallet-warehouse-mock/tertiary/office-piano.png'
import iconOfficeSaxophone from '../assets/pallet-warehouse-mock/tertiary/office-saxophone.png'
import iconOfficeFlute from '../assets/pallet-warehouse-mock/tertiary/office-flute.png'
import iconOfficeKeyboard from '../assets/pallet-warehouse-mock/tertiary/office-keyboard.png'
import iconOfficeGuzheng from '../assets/pallet-warehouse-mock/tertiary/office-guzheng.png'
import iconOfficePipa from '../assets/pallet-warehouse-mock/tertiary/office-pipa.png'
import iconOfficeErhu from '../assets/pallet-warehouse-mock/tertiary/office-erhu.png'
import iconOfficeHulusi from '../assets/pallet-warehouse-mock/tertiary/office-hulusi.png'
import iconOfficeYangqin from '../assets/pallet-warehouse-mock/tertiary/office-yangqin.png'
import iconOfficeMidiKeyboard from '../assets/pallet-warehouse-mock/tertiary/office-midi-keyboard.png'
import iconOfficeSoundCard from '../assets/pallet-warehouse-mock/tertiary/office-sound-card.png'
import iconOfficeMidiController from '../assets/pallet-warehouse-mock/tertiary/office-midi-controller.png'
import iconOfficeMusicSoftware from '../assets/pallet-warehouse-mock/tertiary/office-music-software.png'
import iconOfficeMonitorHeadphone from '../assets/pallet-warehouse-mock/tertiary/office-monitor-headphone.png'

export const MOCK_CATEGORIES: { name: string; children: string[] }[] = [
  { name: '汽车用品', children: ['汽车内饰用品', '车身及附件', '外饰/改装/配件', '摩托车配附件', '车载电器', '车灯', '美容养护', '影音导航', '安全/应急/自驾', '座垫脚垫', '电动车', '汽车内饰改装', '汽车配件', '整车'] },
  { name: '汽摩及配件', children: ['发动系统', '电动车配件', '车用仪表', '电源、点火系统', '冷却系统', '行走系统', '制动系统', '传动系统', '转向系统', '库存汽摩配件', '电动车控制器', '摩托车', '商用车', '汽摩产品制造设备', '汽车维修设备', '专用汽车', '乘用车', '加油站设备', '汽摩及配件项目合作', '停车场设备', '汽摩及配件代理加盟', '二手汽车', 'LED车灯'] },
  { name: '五金、工具', children: ['紧固件、连接件', '电动工具', '园林五金工具', '通用五金配件', '维护工具', '磨具磨料', '组合工具', '手动扳手', '手动工具', '工具耗材', '钳类工具', '泵', '仓储设备', '刀', '工具刷', '运输搬运设备', '手动螺丝刀', '阀门', '气焊、气割器材', '塑料加工', '钳工工具', '管道及配件', '工艺礼品五金', '钳工工作台', '模型、手板', '减速机、变速机', '库存五金、工具', '3D打印机', '模具标准件', '离合器', '防爆工具', '量仪', '刃具', '电子焊接工具', '办公文教五金', '制动器', '作业平台', '五金工具项目合作', '适老工具'] },
  { name: '花园与户外', children: [] },
  { name: '办公、文化', children: ['工艺品', '气氛、布置用品', '书写工具', '学习文具', '仿真园艺', '钥匙配饰', '纸品本册', '圣诞用品', '美术、书法、绘图用品', '办公收纳', '展示用品', '装订、胶粘、桌面用品', '节庆用品', '办公设备', '商务礼品', '婚庆用品', '手账', '乐器', '行政用品', '创意礼品', '工艺摆件', '办公用纸', '文化用品', '动漫/影视/明星周边', '财务用品', '宗教用品', '耗材', '书籍、出版物', '聚会/魔术/演出用品', '祭祀/殡葬用品', '教学模型、器材', '民间工艺品', '工艺品配件', '邮票/钱币/纪念币', '实验室用品', '古董/古玩/收藏', '学习类电子产品', '春节用品', '乐器配件', '西洋乐器', '民族乐器', 'MIDI乐器/电脑音乐'] },
  { name: '居家日用品', children: ['居家日用', '挡风、遮阳、防雨工具', '打火机及烟具', '酒店用品', '秤', '保暖贴/怀炉/保暖用品', 'USB新奇特', '收纳用品', '清洁用具', '厨房日用'] },
  { name: '家具', children: ['卧室家具', '客厅家具', '电竞家具'] },
]

// 三级类目目录（flyout 图标网格唯一来源）：家具沿用 mock 商品三级；汽车内饰用品对照 1688 汽车用品三级类目建设
export const MOCK_TERTIARY_CATALOG: Record<string, { name: string; icon: string }[]> = {
  卧室家具: [
    { name: '双层床', icon: '🛏️' }, { name: '高架床', icon: '🪜' }, { name: '软包床', icon: '🛌' }, { name: '儿童床', icon: '🧒' }, { name: '床尾凳', icon: '🪑' }, { name: '平板床', icon: '🛏️' }, { name: '床头柜', icon: '🗃️' }
  ],
  客厅家具: [
    { name: '沙发床', icon: '🛋️' }, { name: '餐桌椅', icon: '🍽️' }, { name: '置物架', icon: '🗄️' }
  ],
  电竞家具: [
    { name: '电竞床架', icon: '🎮' }, { name: '电竞桌', icon: '🖥️' }
  ],
  汽车内饰用品: [
    { name: '其他汽车内饰用品', icon: iconOtherInterior }, { name: '车载手机支架', icon: iconPhoneMount }, { name: '车用置物袋/置物箱', icon: iconStorageBag }, { name: '车用香水香薰', icon: iconPerfume }, { name: '遮阳挡', icon: iconSunShade }, { name: '头枕', icon: iconHeadrest },
    { name: '汽车摆件', icon: iconOrnament }, { name: '车挂', icon: iconHanging }, { name: '车用钥匙包', icon: iconKeyCase }, { name: '方向盘套', icon: iconWheelCover }, { name: '腰靠', icon: iconLumbarSupport }, { name: '车用水杯架/饮料架', icon: iconCupHolder },
    { name: '临时停车牌', icon: iconParkingPlate }, { name: '车载充气床', icon: iconInflatableBed }, { name: '安全带护肩', icon: iconBeltPad }, { name: '防滑垫', icon: iconAntiSlipMat }, { name: '车用窗帘', icon: iconCurtain }, { name: '迎宾踏板、脚踏板', icon: iconPedal },
    { name: '扶手箱垫', icon: iconArmrestPad }, { name: '手刹套/档把套/套饰套装', icon: iconGearCover }, { name: '车用眼镜夹/票据夹', icon: iconGlassesClip }, { name: '扶手箱', icon: iconArmrestBox }, { name: '车用纸巾盒/套', icon: iconTissueBox }, { name: '车用烟灰缸', icon: iconAshtray },
    { name: '车载桌板', icon: iconTableBoard }, { name: '车用炭类吸附品', icon: iconCharcoal }, { name: '方向盘助力器', icon: iconWheelBooster }, { name: '车载避光垫', icon: iconDashMat }, { name: '椅背防踢垫', icon: iconKickPad }, { name: '香水座', icon: iconPerfumeSeat },
    { name: '车用温度计', icon: iconThermometer }, { name: '遮阳板后视', icon: iconVisorMirror }, { name: '静电棒/钥匙', icon: iconStaticStick }, { name: 'CD包/夹/袋', icon: iconCdCase }, { name: '车用指南针/地图', icon: iconCompass }
  ],
  车身及附件: [
    { name: '其他车身及附件', icon: iconBodyOther }, { name: '驾驶室及配件', icon: iconBodyCab }, { name: '车牌架/牌照托', icon: iconBodyPlateFrame }, { name: '玻璃升降器', icon: iconBodyWindowLifter }, { name: '汽车喇叭/高音头', icon: iconBodyHorn }, { name: '气门嘴', icon: iconBodyValve },
    { name: '车镜', icon: iconBodyMirror }, { name: '雨刮器', icon: iconBodyWiper }, { name: '排气管', icon: iconBodyExhaustPipe }, { name: '扶手、把手、拉手', icon: iconBodyHandle }, { name: '车用密封条', icon: iconBodySealStrip }, { name: '中网', icon: iconBodyGrille },
    { name: '车用天线', icon: iconBodyAntenna }, { name: '轴承', icon: iconBodyBearing }, { name: '行李架', icon: iconBodyLuggageRack }, { name: '座椅及附件', icon: iconBodySeat }, { name: '保险杠', icon: iconBodyBumper }, { name: '汽车消声器', icon: iconBodyMuffler },
    { name: '车底防护板/发动机挡板', icon: iconBodyUnderGuard }, { name: '倒车镜/后视镜总成', icon: iconBodySideMirror }, { name: '汽车电瓶/蓄电池', icon: iconBodyBattery }, { name: '叶子板', icon: iconBodyFender }, { name: '冲压件、挤压件', icon: iconBodyStamping }, { name: '车门', icon: iconBodyDoor },
    { name: '汽车玻璃', icon: iconBodyGlass }, { name: '安全气囊', icon: iconBodyAirbag }, { name: '车壳', icon: iconBodyShell }
  ],
  '外饰/改装/配件': [
    { name: '其他汽车改装件', icon: iconExtOther }, { name: '汽车车衣', icon: iconExtCarCover }, { name: '车身贴', icon: iconExtBodySticker }, { name: '其他汽车外饰用品', icon: iconExtOrnament }, { name: '防撞胶条/防刮条', icon: iconExtBumperStrip }, { name: '汽车遮雪挡', icon: iconExtSnowShade },
    { name: '轮毂盖', icon: iconExtWheelCap }, { name: '大视野后视辅助镜', icon: iconExtBlindMirror }, { name: '大包围', icon: iconExtBodyKit }, { name: '挡泥板', icon: iconExtMudFlap }, { name: '定风翼', icon: iconExtSpoiler }, { name: '晴雨挡', icon: iconExtRainGuard },
    { name: '汽车膜', icon: iconExtWindowFilm }, { name: '备胎罩', icon: iconExtTireCover }, { name: '车窗饰条', icon: iconExtWindowTrim }, { name: '汽车车标', icon: iconExtLogo }, { name: '油箱盖', icon: iconExtFuelCap }, { name: '扰流板', icon: iconExtDisturber },
    { name: '安定器', icon: iconExtStabilizer }, { name: '门腕', icon: iconExtDoorHandle }, { name: '汽车防虫网', icon: iconExtInsectNet }, { name: '汽车吸音棉', icon: iconExtSoundCotton }, { name: '轮眉', icon: iconExtWheelArch }, { name: '汽车改色膜', icon: iconExtWrapFilm },
    { name: '灯眉', icon: iconExtLightBrow }, { name: '灯框', icon: iconExtLightFrame }, { name: '后视镜防雨贴', icon: iconExtMirrorFilm }, { name: '汽车漆面保护膜', icon: iconExtPaintFilm }, { name: '汽车大灯保护膜', icon: iconExtHeadlightFilm }, { name: '天窗及配件', icon: iconExtSunroof },
    { name: '刹车卡钳罩', icon: iconExtCaliperCover }, { name: '车载自行车架', icon: iconExtBikeRack }, { name: '冷光片', icon: iconExtElSheet }
  ],
  摩托车配附件: [
    { name: '摩托车用品与附件', icon: iconMotoBag }, { name: '摩托车通用件', icon: iconMotoParts }, { name: '摩托车/电动车安全头盔', icon: iconMotoHelmet }, { name: '摩托车安全用品', icon: iconMotoProtect }, { name: '摩托车头盔耳机', icon: iconMotoIntercom }, { name: '摩托车尾箱', icon: iconMotoTailBox },
    { name: '摩托车后视镜', icon: iconMotoMirror }, { name: '摩托车头盔配件', icon: iconMotoVisor }, { name: '摩托车发动机及配件', icon: iconMotoEngine }, { name: '摩托车坐垫', icon: iconMotoSeat }, { name: '摩托车把套', icon: iconMotoGrip }, { name: '摩托车前挡风', icon: iconMotoWindshield },
    { name: '摩托车排气管', icon: iconMotoExhaust }, { name: '摩托车电器与仪表', icon: iconMotoMeter }, { name: '摩托车脚踏板', icon: iconMotoFootboard }, { name: '摩托车头盔饰配', icon: iconMotoDecal }, { name: '摩托车传动系统零件', icon: iconMotoTransmission }, { name: '摩托车操纵系统零件', icon: iconMotoLever },
    { name: '摩托车挡泥板', icon: iconMotoFender }, { name: '摩托车保险杠', icon: iconMotoBumper }, { name: '摩托车车架', icon: iconMotoFrame }, { name: '摩托车钥匙', icon: iconMotoKey }, { name: '摩托车牌照框', icon: iconMotoPlate }, { name: '摩托车车锁', icon: iconMotoLock },
    { name: '摩托车化油器', icon: iconMotoCarburetor }, { name: '摩托车行走系统零件', icon: iconMotoWheelPart }, { name: '摩托车尾翼', icon: iconMotoTailWing }, { name: '摩托车轮毂', icon: iconMotoWheel }, { name: '摩托车头盔防雾膜', icon: iconMotoAntifog }, { name: '摩托车儿童座椅', icon: iconMotoChildSeat }
  ],
  车载电器: [
    { name: '车载充电器', icon: iconElecCharger }, { name: '行车记录仪', icon: iconElecDvr }, { name: 'GPS/导航仪', icon: iconElecGps }, { name: '车载播放器/MP3', icon: iconElecPlayer }, { name: '车载显示屏/抬头显示', icon: iconElecHud }, { name: '倒车雷达/影像', icon: iconElecReverse },
    { name: '车载喇叭', icon: iconElecSpeaker }, { name: '车载低音炮', icon: iconElecSubwoofer }, { name: '车载功放', icon: iconElecAmplifier }, { name: '车载空气净化器', icon: iconElecPurifier }, { name: '车载加湿器', icon: iconElecHumidifier }, { name: '车载冰箱', icon: iconElecFridge },
    { name: '车载吸尘器', icon: iconElecVacuum }, { name: '车载逆变器', icon: iconElecInverter }, { name: '车载OBD诊断仪', icon: iconElecObd }, { name: '车载电视天线', icon: iconElecAntenna }, { name: '车载对讲机', icon: iconElecIntercom }, { name: '其他车载电器', icon: iconElecOther }
  ],
  车灯: [
    { name: '大灯总成', icon: iconLightHeadlight }, { name: '尾灯总成', icon: iconLightTail }, { name: '雾灯', icon: iconLightFog }, { name: '日间行车灯', icon: iconLightDrl }, { name: '转向灯', icon: iconLightTurn }, { name: '刹车灯', icon: iconLightBrake },
    { name: '倒车灯', icon: iconLightReverse }, { name: '牌照灯', icon: iconLightPlate }, { name: '室内灯', icon: iconLightDome }, { name: '阅读灯', icon: iconLightReading }, { name: '后备箱灯', icon: iconLightTrunk }, { name: '车门迎宾灯', icon: iconLightWelcome },
    { name: '灯条/越野灯', icon: iconLightBar }, { name: '大灯罩/清洗器', icon: iconLightLens }, { name: '汽车灯泡', icon: iconLightBulb }, { name: '其他车灯', icon: iconLightOther }
  ],
  美容养护: [
    { name: '洗车水枪', icon: iconCareGun }, { name: '洗车海绵', icon: iconCareSponge }, { name: '洗车毛巾', icon: iconCareTowel }, { name: '汽车玻璃水', icon: iconCareWasher }, { name: '车蜡', icon: iconCareWax }, { name: '釉/封釉/镀膜', icon: iconCareCoating },
    { name: '内饰清洁剂', icon: iconCareInteriorCleaner }, { name: '轮胎清洁剂', icon: iconCareTireCleaner }, { name: '发动机清洁剂', icon: iconCareEngineCleaner }, { name: '玻璃清洁剂', icon: iconCareGlassCleaner }, { name: '多功能泡沫清洁剂', icon: iconCareFoam }, { name: '空调清洁剂', icon: iconCareAcCleaner },
    { name: '除味剂/空气清新', icon: iconCareOdor }, { name: '抛光机', icon: iconCarePolisher }, { name: '打蜡机', icon: iconCareWaxMachine }, { name: '轮胎光亮剂', icon: iconCareTireShine }, { name: '除锈剂', icon: iconCareRust }, { name: '其他美容养护', icon: iconCareOther }
  ],
  影音导航: [
    { name: '车载导航机', icon: iconAvNav }, { name: '中控大屏', icon: iconAvScreen }, { name: '液晶仪表', icon: iconAvCluster }, { name: '主机', icon: iconAvHeadunit }, { name: '车载音箱套装', icon: iconAvSpeakerSet }, { name: '功放', icon: iconAvAmp },
    { name: '音频处理器/DSP', icon: iconAvDsp }, { name: '低音炮箱体', icon: iconAvSubBox }, { name: '音响安装配件', icon: iconAvInstall }, { name: '导航地图/升级', icon: iconAvMap }, { name: '倒车影像显示器', icon: iconAvMonitor }, { name: '360全景影像', icon: iconAv360 },
    { name: '行车记录仪云镜', icon: iconAvCloudMirror }, { name: '其他影音导航', icon: iconAvOther }
  ],
  '安全/应急/自驾': [
    { name: '灭火器', icon: iconSafetyExtinguisher }, { name: '三角警示牌', icon: iconSafetyTriangle }, { name: '反光背心', icon: iconSafetyVest }, { name: '安全锤', icon: iconSafetyHammer }, { name: '拖车绳', icon: iconSafetyTowRope }, { name: '搭火线', icon: iconSafetyCable },
    { name: '补胎工具', icon: iconSafetyTireTool }, { name: '便携充气泵', icon: iconSafetyPump }, { name: '备胎', icon: iconSafetySpare }, { name: '应急启动电源', icon: iconSafetyJumpStarter }, { name: '车载急救包', icon: iconSafetyFirstaid }, { name: '绝缘阻燃胶带', icon: iconSafetyTape },
    { name: '防滑链', icon: iconSafetyChain }, { name: '车顶行李箱', icon: iconSafetyRoofBox }, { name: '旅行水箱', icon: iconSafetyWaterTank }, { name: '车载雨伞', icon: iconSafetyUmbrella }, { name: '逃生装置', icon: iconSafetyEscape }, { name: '其他安全/应急/自驾', icon: iconSafetyOther }
  ],
  座垫脚垫: [
    { name: '全包围脚垫', icon: iconCushionFullMat }, { name: '后备箱垫', icon: iconCushionTrunkMat }, { name: '单片脚垫', icon: iconCushionSingleMat }, { name: '座垫', icon: iconCushionCushion }, { name: '座套', icon: iconCushionCover }, { name: '按摩垫', icon: iconCushionMassage },
    { name: '夏季凉垫', icon: iconCushionSummer }, { name: '冬季暖垫', icon: iconCushionWinter }, { name: '皮质座套', icon: iconCushionLeather }, { name: '布艺座套', icon: iconCushionFabric }, { name: '脚垫皮质套装', icon: iconCushionLeatherSet }, { name: '丝圈脚垫', icon: iconCushionSilkLoop },
    { name: '橡胶脚垫', icon: iconCushionRubber }, { name: '后备箱收纳箱', icon: iconCushionTrunkBox }, { name: '儿童座椅垫', icon: iconCushionKids }, { name: '其他座垫脚垫', icon: iconCushionOther }
  ],
  电动车: [
    { name: '电动自行车', icon: iconEvBicycle }, { name: '电动摩托车', icon: iconEvMotorcycle }, { name: '电动三轮车', icon: iconEvTricycle }, { name: '电动平衡车', icon: iconEvBalance }, { name: '电动滑板车', icon: iconEvSkateboard }, { name: '老年代步车', icon: iconEvMobility },
    { name: '电动观光车', icon: iconEvSightseeing }, { name: '电动巡逻车', icon: iconEvPatrol }, { name: '电动车电池', icon: iconEvBattery }, { name: '电动车电机', icon: iconEvMotor }, { name: '电动车控制器', icon: iconEvController }, { name: '电动车充电器', icon: iconEvCharger },
    { name: '电动车轮胎', icon: iconEvTire }, { name: '电动车锁', icon: iconEvLock }, { name: '电动车车架', icon: iconEvFrame }, { name: '其他电动车', icon: iconEvOther }
  ],
  汽车内饰改装: [
    { name: '内饰氛围灯', icon: iconRefitAmbient }, { name: '改装座椅', icon: iconRefitSeat }, { name: '内饰贴膜', icon: iconRefitWrap }, { name: '碳纤维内饰件', icon: iconRefitCarbon }, { name: '踏板套装', icon: iconRefitPedal }, { name: '油门加速器', icon: iconRefitThrottle },
    { name: '排气尾喉', icon: iconRefitExhaustTip }, { name: '隔音棉', icon: iconRefitSoundproof }, { name: '地板革', icon: iconRefitFloorLeather }, { name: '顶棚布料', icon: iconRefitCeiling }, { name: '门板包皮', icon: iconRefitDoorLeather }, { name: '仪表台改装', icon: iconRefitDash },
    { name: '档把改装', icon: iconRefitKnob }, { name: '手刹改装', icon: iconRefitHandbrake }, { name: '方向盘改装', icon: iconRefitWheel }, { name: '其他内饰改装', icon: iconRefitOther }
  ],
  汽车配件: [
    { name: '发动机总成', icon: iconPartEngine }, { name: '气缸体', icon: iconPartBlock }, { name: '气缸盖', icon: iconPartHead }, { name: '曲轴', icon: iconPartCrankshaft }, { name: '凸轮轴', icon: iconPartCamshaft }, { name: '活塞', icon: iconPartPiston },
    { name: '正时皮带/链条', icon: iconPartTiming }, { name: '水泵', icon: iconPartWaterPump }, { name: '机油泵', icon: iconPartOilPump }, { name: '涡轮增压器', icon: iconPartTurbo }, { name: '中冷器', icon: iconPartIntercooler }, { name: '散热器/水箱', icon: iconPartRadiator },
    { name: '冷却风扇', icon: iconPartFan }, { name: '离合器套件', icon: iconPartClutch }, { name: '变速箱总成', icon: iconPartGearbox }, { name: '传动轴', icon: iconPartDriveshaft }, { name: '半轴', icon: iconPartAxle }, { name: '万向节', icon: iconPartJoint },
    { name: '刹车片', icon: iconPartBrakePad }, { name: '刹车盘', icon: iconPartBrakeDisc }, { name: '刹车卡钳', icon: iconPartCaliper }, { name: '减震器', icon: iconPartShock }, { name: '悬挂摆臂', icon: iconPartArm }, { name: '其他汽车配件', icon: iconPartOther }
  ],
  整车: [
    { name: '汽油轿车', icon: iconVehicleGasoline }, { name: '柴油轿车', icon: iconVehicleDiesel }, { name: '新能源轿车', icon: iconVehicleEv }, { name: 'SUV', icon: iconVehicleSuv }, { name: 'MPV', icon: iconVehicleMpv }, { name: '皮卡', icon: iconVehiclePickup },
    { name: '微型货车', icon: iconVehicleMiniTruck }, { name: '轻型货车', icon: iconVehicleLightTruck }, { name: '重型货车', icon: iconVehicleTruck }, { name: '客车', icon: iconVehicleBus }, { name: '特种车辆', icon: iconVehicleSpecial }, { name: '其他整车', icon: iconVehicleOther }
  ],
  发动系统: [
    { name: '油泵、油嘴', icon: iconQmOilPump }, { name: '其他发动系统', icon: iconQmEngineOther }, { name: '化油器', icon: iconMotoCarburetor }, { name: '增压器', icon: iconPartTurbo }, { name: '空气滤清器', icon: iconQmAirFilter }, { name: '气缸及部件', icon: iconQmCylinder },
    { name: '机油滤清器', icon: iconQmOilFilter }, { name: '柴油滤清器', icon: iconQmDieselFilter }, { name: '气门及部件', icon: iconQmValveParts }, { name: '起动机及配件', icon: iconQmStarter }, { name: '发动机总成', icon: iconPartEngine }, { name: '曲轴、凸轮轴', icon: iconPartCrankshaft },
    { name: '三元催化器', icon: iconQmCatalyst }, { name: '涨紧轮', icon: iconQmTensioner }, { name: '进气总管', icon: iconQmIntakePipe }, { name: '空调滤清器', icon: iconQmCabinFilter }, { name: '油管', icon: iconQmOilLine }, { name: '进气歧管', icon: iconQmIntakeManifold }
  ],
  电动车配件: [
    { name: '电动车电池', icon: iconEvBattery }, { name: '电动车电机', icon: iconEvMotor }, { name: '电动车控制器', icon: iconEvController }, { name: '电动车充电器', icon: iconEvCharger }, { name: '电动车轮胎', icon: iconEvTire }, { name: '电动车锁', icon: iconEvLock },
    { name: '电动车车架', icon: iconEvFrame }, { name: '转把/刹把', icon: iconQmEvGrip }, { name: '电动车仪表', icon: iconQmEvMeter }, { name: '电动车轮毂', icon: iconMotoWheel }
  ],
  车用仪表: [
    { name: '组合仪表总成', icon: iconQmCluster }, { name: '车速里程表', icon: iconQmSpeedometer }, { name: '转速表', icon: iconQmTachometer }, { name: '燃油表', icon: iconQmFuelGauge }, { name: '水温表', icon: iconQmTempGauge }, { name: '机油压力表', icon: iconQmOilGauge },
    { name: '电压表', icon: iconQmVoltGauge }, { name: '其他车用仪表', icon: iconQmMeterOther }
  ],
  '电源、点火系统': [
    { name: '蓄电池', icon: iconBodyBattery }, { name: '发电机', icon: iconQmAlternator }, { name: '点火线圈', icon: iconQmIgnitionCoil }, { name: '火花塞', icon: iconQmSparkPlug }, { name: '电热塞', icon: iconQmGlowPlug }, { name: '点火模块', icon: iconQmIgnitionModule },
    { name: '分电器', icon: iconQmDistributor }, { name: '其他电源、点火', icon: iconQmPowerOther }
  ],
  冷却系统: [
    { name: '散热器/水箱', icon: iconPartRadiator }, { name: '冷却风扇', icon: iconPartFan }, { name: '水泵', icon: iconPartWaterPump }, { name: '节温器', icon: iconQmThermostat }, { name: '散热器水管', icon: iconQmRadiatorHose }, { name: '膨胀箱/副水箱', icon: iconQmExpansionTank },
    { name: '中冷器', icon: iconPartIntercooler }, { name: '其他冷却系统', icon: iconQmCoolingOther }
  ],
  行走系统: [
    { name: '减震器', icon: iconPartShock }, { name: '悬挂摆臂', icon: iconPartArm }, { name: '半轴', icon: iconPartAxle }, { name: '万向节', icon: iconPartJoint }, { name: '轮毂', icon: iconQmWheelHub }, { name: '轮胎', icon: iconEvTire },
    { name: '轮辋/轮圈', icon: iconMotoWheel }, { name: '平衡杆/稳定杆', icon: iconQmSwayBar }, { name: '球头', icon: iconQmBallJoint }, { name: '其他行走系统', icon: iconQmRunningOther }
  ],
  制动系统: [
    { name: '刹车片', icon: iconPartBrakePad }, { name: '刹车盘', icon: iconPartBrakeDisc }, { name: '刹车卡钳', icon: iconPartCaliper }, { name: '制动总泵', icon: iconQmBrakeMaster }, { name: '制动分泵', icon: iconQmBrakeWheel }, { name: '刹车油管/软管', icon: iconQmBrakeHose },
    { name: 'ABS 总成', icon: iconQmAbs }, { name: '驻车制动总成', icon: iconQmParkingBrake }, { name: '刹车助力器', icon: iconQmBrakeBooster }, { name: '其他制动系统', icon: iconQmBrakeOther }
  ],
  传动系统: [
    { name: '离合器套件', icon: iconPartClutch }, { name: '变速箱总成', icon: iconPartGearbox }, { name: '传动轴', icon: iconPartDriveshaft }, { name: '等速万向节', icon: iconQmCvJoint }, { name: '飞轮', icon: iconQmFlywheel }, { name: '换挡线/杆', icon: iconQmShiftCable },
    { name: '液力变矩器', icon: iconQmTorqueConverter }, { name: '同步器', icon: iconQmSynchronizer }, { name: '链条/皮带', icon: iconQmChainBelt }, { name: '其他传动系统', icon: iconQmTransOther }
  ],
  转向系统: [
    { name: '转向机总成', icon: iconQmSteeringRack }, { name: '方向盘', icon: iconRefitWheel }, { name: '拉杆/球头', icon: iconQmTieRod }, { name: '转向柱', icon: iconQmSteeringColumn }, { name: '转向助力泵', icon: iconQmSteeringPump }, { name: '转向减震器', icon: iconQmSteeringDamper },
    { name: '转向节/羊角', icon: iconQmKnuckle }, { name: '其他转向系统', icon: iconQmSteeringOther }
  ],
  库存汽摩配件: [
    { name: '库存发动机件', icon: iconPartEngine }, { name: '库存底盘件', icon: iconPartArm }, { name: '库存电器件', icon: iconElecOther }, { name: '库存车身件', icon: iconBodyOther }, { name: '库存摩托车件', icon: iconMotoParts }, { name: '其他库存汽摩', icon: iconPartOther }
  ],
  电动车控制器: [
    { name: '电动车主控', icon: iconEvController }, { name: '无刷控制器', icon: iconQmCtrlBrushless }, { name: '有刷控制器', icon: iconQmCtrlBrushed }, { name: '控制器线束', icon: iconQmCtrlHarness }, { name: '控制器外壳/散热', icon: iconQmCtrlHeatsink }, { name: '其他电动车控制器', icon: iconQmCtrlOther }
  ],
  摩托车: [
    { name: '摩托车整车', icon: iconQmMotoWhole }, { name: '摩托车发动机', icon: iconMotoEngine }, { name: '摩托车车架', icon: iconMotoFrame }, { name: '摩托车轮毂', icon: iconMotoWheel }, { name: '摩托车车身件', icon: iconMotoFender }, { name: '摩托车电器与仪表', icon: iconMotoMeter },
    { name: '摩托车排气系统', icon: iconMotoExhaust }, { name: '摩托车传动系统', icon: iconMotoTransmission }, { name: '摩托车操纵系统', icon: iconMotoLever }, { name: '其他摩托车', icon: iconMotoParts }
  ],
  商用车: [
    { name: '货车', icon: iconVehicleTruck }, { name: '轻型货车', icon: iconVehicleLightTruck }, { name: '微型货车', icon: iconVehicleMiniTruck }, { name: '客车', icon: iconVehicleBus }, { name: '大巴/教练车', icon: iconQmCoach }, { name: '半挂车', icon: iconQmSemitrailer },
    { name: '自卸车', icon: iconQmDumpTruck }, { name: '其他商用车', icon: iconVehicleOther }
  ],
  汽摩产品制造设备: [
    { name: '装配线设备', icon: iconQmMfgLine }, { name: '机械加工设备', icon: iconQmMfgMachine }, { name: '焊接设备', icon: iconQmMfgWeld }, { name: '涂装设备', icon: iconQmMfgPaint }, { name: '检测设备', icon: iconQmMfgTest }, { name: '模具夹具', icon: iconQmMfgMold },
    { name: '轮胎制造设备', icon: iconQmMfgTire }, { name: '其他制造设备', icon: iconQmMfgOther }
  ],
  汽车维修设备: [
    { name: '举升机', icon: iconQmRepairLift }, { name: '车轮平衡机', icon: iconQmRepairBalancer }, { name: '扒胎机', icon: iconQmRepairChanger }, { name: '四轮定位仪', icon: iconQmRepairAligner }, { name: '诊断扫描仪', icon: iconElecObd }, { name: '钣金修复设备', icon: iconQmRepairBody },
    { name: '喷漆烤漆房', icon: iconQmRepairPaintBooth }, { name: '保养工具', icon: iconQmRepairTools }, { name: '千斤顶/吊机', icon: iconQmRepairJack }, { name: '其他维修设备', icon: iconQmRepairOther }
  ],
  专用汽车: [
    { name: '特种车辆', icon: iconVehicleSpecial }, { name: '消防车', icon: iconQmSpecialFire }, { name: '救护车', icon: iconQmSpecialAmbulance }, { name: '警车', icon: iconQmSpecialPolice }, { name: '工程车', icon: iconQmSpecialEngineering }, { name: '环卫车', icon: iconQmSpecialSanitation },
    { name: '冷藏车', icon: iconQmSpecialRefrigerated }, { name: '其他专用汽车', icon: iconQmSpecialOther }
  ],
  乘用车: [
    { name: '汽油轿车', icon: iconVehicleGasoline }, { name: '柴油轿车', icon: iconVehicleDiesel }, { name: '新能源轿车', icon: iconVehicleEv }, { name: 'SUV', icon: iconVehicleSuv }, { name: 'MPV', icon: iconVehicleMpv }, { name: '皮卡', icon: iconVehiclePickup },
    { name: '跑车/轿跑', icon: iconQmPassengerCoupe }, { name: '其他乘用车', icon: iconVehicleOther }
  ],
  加油站设备: [
    { name: '加油机', icon: iconQmFuelDispenser }, { name: '储油罐', icon: iconQmFuelTank }, { name: '输油泵', icon: iconQmFuelPump }, { name: '加油枪', icon: iconQmFuelNozzle }, { name: '液位仪', icon: iconQmFuelGaugeLevel }, { name: '油气回收装置', icon: iconQmFuelVapor },
    { name: '加油站标识', icon: iconQmFuelSign }, { name: '其他加油站设备', icon: iconQmFuelOther }
  ],
  汽摩及配件项目合作: [
    { name: '项目合作', icon: iconQmCoopProject }, { name: '技术转让', icon: iconQmCoopTech }, { name: '合资合作', icon: iconQmCoopJoint }, { name: '其他项目合作', icon: iconQmCoopOther }
  ],
  停车场设备: [
    { name: '道闸/栏杆机', icon: iconQmParkBarrier }, { name: '车位锁', icon: iconQmParkLock }, { name: '停车引导系统', icon: iconQmParkGuide }, { name: '充电桩', icon: iconQmParkCharger }, { name: '车棚/膜结构', icon: iconQmParkShade }, { name: '道路标线/标识', icon: iconQmParkMark },
    { name: '监控摄像', icon: iconQmParkCamera }, { name: '其他停车场设备', icon: iconQmParkOther }
  ],
  汽摩及配件代理加盟: [
    { name: '代理加盟', icon: iconQmAgent }, { name: '区域代理', icon: iconQmAgentRegion }, { name: '独家代理', icon: iconQmAgentExclusive }, { name: '其他代理加盟', icon: iconQmAgentOther }
  ],
  二手汽车: [
    { name: '二手乘用车', icon: iconVehicleGasoline }, { name: '二手SUV', icon: iconVehicleSuv }, { name: '二手MPV', icon: iconVehicleMpv }, { name: '二手货车', icon: iconVehicleTruck }, { name: '二手摩托车', icon: iconQmMotoWhole }, { name: '其他二手汽车', icon: iconVehicleOther }
  ],
  LED车灯: [
    { name: 'LED大灯', icon: iconLightHeadlight }, { name: 'LED尾灯', icon: iconLightTail }, { name: 'LED雾灯', icon: iconLightFog }, { name: 'LED日行灯', icon: iconLightDrl }, { name: 'LED转向灯', icon: iconLightTurn }, { name: 'LED工作灯', icon: iconLightBar },
    { name: 'LED室内灯', icon: iconLightDome }, { name: 'LED灯泡', icon: iconLightBulb }
  ],
  居家日用: [
    { name: '其他居家日用', icon: iconHomeOther }, { name: '冰箱贴', icon: iconHomeFridgeMagnet }, { name: '针线、别针、缝纫', icon: iconHomeSewing }, { name: '其他一次性用品', icon: iconHomeDisposableOther }, { name: '护眼罩', icon: iconHomeEyeMask }, { name: '一次性内裤', icon: iconHomeDisposableUnderwear },
    { name: '扇子', icon: iconHomeFan }, { name: '家用剪刀', icon: iconHomeScissors }, { name: '鞋套、鞋刷、鞋用品', icon: iconHomeShoeBrush }, { name: '一次性床单', icon: iconHomeDisposableSheet }, { name: '家用梯', icon: iconHomeLadder }, { name: '防打鼾用品', icon: iconHomeAntiSnore },
    { name: '防烫、防高温手套', icon: iconHomeOvenGloves }, { name: '吸奶器', icon: iconHomeBreastPump }, { name: '一次性鞋套', icon: iconHomeShoeCovers }, { name: '迷你手持扇', icon: iconHomeHandheldFan }, { name: '冰垫', icon: iconHomeIcePad }, { name: '温度计、水温计', icon: iconThermometer }
  ],
  '挡风、遮阳、防雨工具': [
    { name: '雨伞', icon: iconSafetyUmbrella }, { name: '雨衣', icon: iconHomeRaincoat }, { name: '遮阳伞/太阳伞', icon: iconHomeSunUmbrella }, { name: '挡风板', icon: iconHomeWindshieldBoard }, { name: '雨棚/帐篷', icon: iconHomeCanopy }, { name: '伞配件', icon: iconHomeUmbrellaParts },
    { name: '防雨罩', icon: iconHomeRainCover }, { name: '其他挡风遮阳防雨', icon: iconHomeRainOther }
  ],
  打火机及烟具: [
    { name: '打火机', icon: iconHomeLighter }, { name: '烟盒', icon: iconHomeCigaretteCase }, { name: '烟嘴/过滤器', icon: iconHomeCigaretteHolder }, { name: '烟灰缸', icon: iconAshtray }, { name: '喷枪打火机', icon: iconHomeTorchLighter }, { name: '打火石/配件', icon: iconHomeFlint },
    { name: '戒烟用品', icon: iconHomeQuitSmoking }, { name: '其他烟具', icon: iconHomeSmokeOther }
  ],
  酒店用品: [
    { name: '一次性洗漱套装', icon: iconHomeHotelAmenity }, { name: '酒店拖鞋', icon: iconHomeHotelSlippers }, { name: '酒店床品套件', icon: iconHomeHotelBedding }, { name: '毛巾/浴巾', icon: iconCareTowel }, { name: '洗漱杯/用品', icon: iconHomeHotelCup }, { name: '酒店标识/牌', icon: iconHomeHotelSign },
    { name: '客房电器', icon: iconHomeHotelAppliance }, { name: '其他酒店用品', icon: iconHomeHotelOther }
  ],
  秤: [
    { name: '厨房秤', icon: iconHomeKitchenScale }, { name: '体重秤/健康秤', icon: iconHomeBodyScale }, { name: '行李秤', icon: iconHomeLuggageScale }, { name: '珠宝秤/口袋秤', icon: iconHomePocketScale }, { name: '台秤/案秤', icon: iconHomePlatformScale }, { name: '吊秤/钩秤', icon: iconHomeHangingScale },
    { name: '地磅/平台秤', icon: iconHomeFloorScale }, { name: '其他秤', icon: iconHomeScaleOther }
  ],
  '保暖贴/怀炉/保暖用品': [
    { name: '暖宝宝/暖贴', icon: iconHomeHeatPatch }, { name: '热水袋', icon: iconHomeHotWaterBag }, { name: '怀炉/催化剂', icon: iconHomeHandStove }, { name: '暖手宝/充电暖手', icon: iconHomeHandWarmer }, { name: '电热毯/暖垫', icon: iconHomeElectricBlanket }, { name: '保暖手套/耳罩', icon: iconHomeWarmEarmuff },
    { name: '暖脚宝/鞋垫', icon: iconHomeFootWarmer }, { name: '其他保暖用品', icon: iconHomeWarmOther }
  ],
  USB新奇特: [
    { name: 'USB风扇', icon: iconHomeUsbFan }, { name: 'USB加湿器', icon: iconHomeUsbHumidifier }, { name: 'USB暖手/暖杯垫', icon: iconHomeUsbCoaster }, { name: 'USB小夜灯', icon: iconHomeUsbNightLight }, { name: 'USB吸尘器', icon: iconHomeUsbVacuum }, { name: 'USB按摩器', icon: iconHomeUsbMassager },
    { name: 'USB冰箱/制冷杯', icon: iconHomeUsbCooler }, { name: '其他USB新奇特', icon: iconHomeUsbOther }
  ],
  收纳用品: [
    { name: '收纳箱', icon: iconHomeStorageBox }, { name: '收纳篮/筐', icon: iconHomeStorageBasket }, { name: '收纳袋/压缩袋', icon: iconHomeStorageBag }, { name: '置物架/层架', icon: iconHomeStorageShelf }, { name: '衣柜收纳分隔', icon: iconHomeClosetDivider }, { name: '桌面收纳', icon: iconHomeDeskOrganizer },
    { name: '鞋盒/鞋架收纳', icon: iconHomeShoeBox }, { name: '厨房收纳架', icon: iconHomeKitchenRack }, { name: '浴室收纳', icon: iconHomeBathroomStorage }, { name: '其他收纳用品', icon: iconHomeStorageOther }
  ],
  清洁用具: [
    { name: '拖把', icon: iconHomeMop }, { name: '扫帚/簸箕', icon: iconHomeBroom }, { name: '抹布/百洁布', icon: iconHomeCloth }, { name: '清洁刷', icon: iconHomeCleanBrush }, { name: '玻璃刮/窗刷', icon: iconHomeGlassSqueegee }, { name: '马桶刷/套装', icon: iconHomeToiletBrush },
    { name: '垃圾桶', icon: iconHomeTrashBin }, { name: '清洁手套', icon: iconHomeCleanGloves }, { name: '除尘掸/刷', icon: iconHomeDuster }, { name: '其他清洁用具', icon: iconHomeCleanOther }
  ],
  厨房日用: [
    { name: '保鲜盒/饭盒', icon: iconHomeLunchBox }, { name: '砧板/菜板', icon: iconHomeCuttingBoard }, { name: '刀具/剪刀套', icon: iconHomeKnifeSet }, { name: '锅具/炒锅', icon: iconHomeCookware }, { name: '餐具/碗碟', icon: iconHomeTableware }, { name: '水杯/保温杯', icon: iconHomeWaterBottle },
    { name: '厨房置物架', icon: iconHomeKitchenShelf }, { name: '烘焙用具', icon: iconHomeBakeware }, { name: '一次性餐具', icon: iconHomeDisposableTableware }, { name: '其他厨房日用', icon: iconHomeKitchenOther }
  ],
  '紧固件、连接件': [
    { name: '螺钉', icon: iconHwScrew }, { name: '螺母', icon: iconHwNut }, { name: '螺栓', icon: iconHwBolt }, { name: '垫圈', icon: iconHwWasher }, { name: '铆钉', icon: iconHwRivet }, { name: '销及键', icon: iconHwPinKey },
    { name: '其他紧固件、连接件', icon: iconHwFastenerOther }, { name: '螺柱', icon: iconHwStandoff }, { name: '组合件及连接副', icon: iconHwComboConnect }, { name: '卡簧、挡圈', icon: iconHwCirclip }, { name: '广告钉', icon: iconHwAdNail }
  ],
  电动工具: [
    { name: '电动工具配件', icon: iconHwPowerAccessory }, { name: '手电钻', icon: iconHwDrill }, { name: '电动螺丝刀、起子机', icon: iconHwElectricScrewdriver }, { name: '电动吹风机', icon: iconHwBlower }, { name: '电动角磨机', icon: iconHwGrinder }, { name: '热风枪', icon: iconHwHeatGun }
  ],
  园林五金工具: [
    { name: '园林剪', icon: iconHwGardenScissors }, { name: '修枝剪/锯', icon: iconHwPruningSaw }, { name: '浇灌工具', icon: iconHwWatering }, { name: '园林喷雾器', icon: iconHwGardenSprayer }, { name: '割草机配件', icon: iconHwMowerParts }, { name: '温室配件', icon: iconHwGreenhouse },
    { name: '园林手工具', icon: iconHwGardenHand }, { name: '其他园林五金', icon: iconHwMisc }
  ],
  通用五金配件: [
    { name: '五金球/台阶', icon: iconHwBall }, { name: '手柄/手轮', icon: iconHwHandle }, { name: '挂钩/吊环', icon: iconHwHook }, { name: '扣具/卡扣', icon: iconHwBuckle }, { name: '链条/链圈', icon: iconHwChain }, { name: '脚轮/万向轮', icon: iconHwCaster },
    { name: '梯子/踏步', icon: iconHwStepLadder }, { name: '其他通用五金', icon: iconHwMisc }
  ],
  维护工具: [
    { name: '黄油枪', icon: iconHwGreaseGun }, { name: '油枪/注油器', icon: iconHwOilGun }, { name: '维修组套', icon: iconHwRepairKit }, { name: '拉拔器', icon: iconHwPuller }, { name: '丝锥板牙组套', icon: iconHwTapDie }, { name: '检测镜', icon: iconHwInspectMirror },
    { name: '维护工具套装', icon: iconHwMaintenanceSet }, { name: '其他维护工具', icon: iconHwMisc }
  ],
  磨具磨料: [
    { name: '砂轮', icon: iconHwGrindingWheel }, { name: '切割片/切片', icon: iconHwCuttingDisc }, { name: '砂纸/砂布', icon: iconHwSandpaper }, { name: '磨料带', icon: iconHwAbrasiveBelt }, { name: '百叶轮/页轮', icon: iconHwFlapDisc }, { name: '抛光轮/抛光机', icon: iconHwPolishWheel },
    { name: '金刚石工具', icon: iconHwDiamondTools }, { name: '其他磨具磨料', icon: iconHwMisc }
  ],
  组合工具: [
    { name: '家用工具套装', icon: iconHwToolSetHome }, { name: '汽修工具套装', icon: iconHwToolSetAuto }, { name: '套筒扳手套装', icon: iconHwSocketSet }, { name: '螺丝刀套装', icon: iconHwScrewdriverSet }, { name: '钳子套装', icon: iconHwPlierSet }, { name: '扳手套装', icon: iconHwWrenchSet },
    { name: '工具箱/包', icon: iconHwToolbox }, { name: '其他组合工具', icon: iconHwMisc }
  ],
  手动扳手: [
    { name: '活动扳手', icon: iconHwWrenchAdjustable }, { name: '双头扳手', icon: iconHwWrenchDouble }, { name: '套筒扳手', icon: iconHwWrenchSocket }, { name: '扭力扳手', icon: iconHwWrenchTorque }, { name: '内六角扳手', icon: iconHwWrenchHex }, { name: '管子扳手', icon: iconHwWrenchPipe },
    { name: '专用扳手', icon: iconHwWrenchSpecial }, { name: '其他手动扳手', icon: iconHwMisc }
  ],
  手动工具: [
    { name: '锤子', icon: iconHwHammer }, { name: '斧子', icon: iconHwAxe }, { name: '螺丝刀', icon: iconHwScrewdriver }, { name: '锉刀/凿刨', icon: iconHwFile }, { name: '锯/手锯', icon: iconHwHandsaw }, { name: '凿子/刨刀', icon: iconHwChisel },
    { name: '专用手工具', icon: iconHwHandSpecial }, { name: '其他手动工具', icon: iconHwMisc }
  ],
  工具耗材: [
    { name: '钻头', icon: iconHwDrillBit }, { name: '锯片', icon: iconHwCuttingDisc }, { name: '磨头/磨针', icon: iconHwGrindingHead }, { name: '刀片', icon: iconHwCutterBlade }, { name: '丝锥/板牙', icon: iconHwTapDie }, { name: '碳刷', icon: iconHwCarbonBrush },
    { name: '雕刻针', icon: iconHwEngravingBit }, { name: '其他工具耗材', icon: iconHwMisc }
  ],
  钳类工具: [
    { name: '钢丝钳', icon: iconHwPlierWire }, { name: '尖嘴钳', icon: iconHwPlierNeedle }, { name: '斜口钳', icon: iconHwPlierDiagonal }, { name: '扁嘴钳', icon: iconHwPlierFlat }, { name: '大力钳', icon: iconHwPlierLock }, { name: '管钳', icon: iconHwPlierPipe },
    { name: '卡簧钳', icon: iconHwPlierCirclip }, { name: '其他钳类工具', icon: iconHwMisc }
  ],
  泵: [
    { name: '离心泵', icon: iconHwPumpCentrifugal }, { name: '自吸泵', icon: iconHwPumpSelfPriming }, { name: '潜水泵', icon: iconHwPumpSubmersible }, { name: '齿轮泵', icon: iconHwPumpGear }, { name: '隔膜泵', icon: iconHwPumpDiaphragm }, { name: '真空泵', icon: iconHwPumpVacuum },
    { name: '磁力泵', icon: iconHwPumpMagnetic }, { name: '其他泵', icon: iconHwMisc }
  ],
  仓储设备: [
    { name: '仓储货架', icon: iconHwRack }, { name: '置物架', icon: iconHwShelf }, { name: '工具柜/工具车', icon: iconHwToolCabinet }, { name: '工作台', icon: iconHwStorageBench }, { name: '收纳箱/零件盒', icon: iconHomeStorageBox }, { name: '托盘/栈板', icon: iconHwPallet },
    { name: '堆垛架', icon: iconHwStackingRack }, { name: '其他仓储设备', icon: iconHwMisc }
  ],
  刀: [
    { name: '厨刀/菜刀', icon: iconHomeKnifeSet }, { name: '水果刀', icon: iconHwKnifeFruit }, { name: '折叠刀/口袋刀', icon: iconHwKnifePocket }, { name: '美工刀/裁纸刀', icon: iconHwKnifeUtility }, { name: '剪刀', icon: iconHomeScissors }, { name: '修剪刀', icon: iconHwKnifePruning },
    { name: '工艺刀', icon: iconHwKnifeCraft }, { name: '其他刀', icon: iconHwMisc }
  ],
  工具刷: [
    { name: '油漆刷/滚筒', icon: iconHwBrushPaint }, { name: '钢丝刷', icon: iconHwBrushWire }, { name: '清洁刷', icon: iconHwBrushClean }, { name: '除尘刷', icon: iconHwBrushDust }, { name: '细节刷', icon: iconHwBrushDetail }, { name: '刷套/刷组', icon: iconHwBrushSet },
    { name: '滚筒架/配件', icon: iconHwBrushRoller }, { name: '其他工具刷', icon: iconHwMisc }
  ],
  运输搬运设备: [
    { name: '手推车', icon: iconHwHandTruck }, { name: '平板车', icon: iconHwPlatformTruck }, { name: '叉车', icon: iconHwForklift }, { name: '液压搬运车', icon: iconHwHydraulicTruck }, { name: '拖车', icon: iconHwCart }, { name: '起重葫芦/吊机', icon: iconHwHoist },
    { name: '升降平台', icon: iconHwPlatformScissor }, { name: '其他运输搬运', icon: iconHwMisc }
  ],
  手动螺丝刀: [
    { name: '十字螺丝刀', icon: iconHwSdPhillips }, { name: '一字螺丝刀', icon: iconHwSdFlat }, { name: '精密螺丝刀套', icon: iconHwSdPrecision }, { name: '棘轮螺丝刀', icon: iconHwSdRatchet }, { name: '绝缘螺丝刀', icon: iconHwSdInsulated }, { name: '多用螺丝刀', icon: iconHwSdMulti },
    { name: '螺丝刀批头', icon: iconHwSdBits }, { name: '其他手动螺丝刀', icon: iconHwMisc }
  ],
  阀门: [
    { name: '球阀', icon: iconHwValveBall }, { name: '闸阀', icon: iconHwValveGate }, { name: '截止阀', icon: iconHwValveStop }, { name: '止回阀', icon: iconHwValveCheck }, { name: '蝶阀', icon: iconHwValveButterfly }, { name: '安全阀', icon: iconHwValveSafety },
    { name: '电磁阀', icon: iconHwValveSolenoid }, { name: '其他阀门', icon: iconHwMisc }
  ],
  '气焊、气割器材': [
    { name: '电焊机', icon: iconHwWelderElectric }, { name: '气焊机', icon: iconHwWelderGas }, { name: '等离子切割机', icon: iconHwPlasmaCutter }, { name: '焊枪/割炬', icon: iconHwWeldingTorch }, { name: '焊帽/面罩', icon: iconHwWeldingMask }, { name: '焊条/焊丝', icon: iconHwWeldingRod },
    { name: '减压器/表', icon: iconHwGasRegulator }, { name: '其他气焊气割', icon: iconHwMisc }
  ],
  塑料加工: [
    { name: '塑料焊枪', icon: iconHwPlasticWelder }, { name: '塑料挤出机', icon: iconHwPlasticExtruder }, { name: '注塑机', icon: iconHwInjectionMachine }, { name: '吹塑机', icon: iconHwBlowMolding }, { name: '塑料破碎机', icon: iconHwPlasticCrusher }, { name: '塑料混合机', icon: iconHwPlasticMixer },
    { name: '热成型机', icon: iconHwThermoforming }, { name: '其他塑料加工', icon: iconHwMisc }
  ],
  钳工工具: [
    { name: '台虎钳', icon: iconHwBenchVise }, { name: '钳工锉', icon: iconHwBenchFile }, { name: '刮刀', icon: iconHwScraper }, { name: '划针', icon: iconHwScribe }, { name: '台钻配件', icon: iconHwBenchDrillParts }, { name: '划线工具', icon: iconHwLayoutTool },
    { name: '钳工套组', icon: iconHwBenchSet }, { name: '其他钳工工具', icon: iconHwMisc }
  ],
  管道及配件: [
    { name: '钢管/无缝管', icon: iconHwPipeSteel }, { name: 'PVC管/PPR管', icon: iconHwPipePvc }, { name: '管件/弯头', icon: iconHwPipeFitting }, { name: '法兰', icon: iconHwFlange }, { name: '软管编织管', icon: iconHwHose }, { name: '快速接头', icon: iconHwQuickConnector },
    { name: '管夹/管卡', icon: iconHwPipeClamp }, { name: '其他管道配件', icon: iconHwMisc }
  ],
  工艺礼品五金: [
    { name: '金属钥匙扣', icon: iconHwKeychain }, { name: '金属徽章', icon: iconHwBadge }, { name: '金属书签', icon: iconHwBookmark }, { name: '五金饰品配件', icon: iconHwJewelryParts }, { name: '金属摆件', icon: iconHwOrnament }, { name: '纪念币/章', icon: iconHwCoin },
    { name: '工艺五金配件', icon: iconHwCraftParts }, { name: '其他工艺礼品', icon: iconHwMisc }
  ],
  钳工工作台: [
    { name: '重型工作台', icon: iconHwBenchstationHeavy }, { name: '防静电工作台', icon: iconHwBenchstationAntistatic }, { name: '工具工作台', icon: iconHwBenchstationTool }, { name: '检测工作台', icon: iconHwBenchstationInspect }, { name: '焊接工作台', icon: iconHwBenchstationWeld }, { name: '工作台配件', icon: iconHwBenchstationParts },
    { name: '定制工作台', icon: iconHwBenchstationCustom }, { name: '其他工作台', icon: iconHwMisc }
  ],
  '模型、手板': [
    { name: '3D打印手板', icon: iconHwModel3d }, { name: 'CNC加工手板', icon: iconHwModelCnc }, { name: '硅胶模型', icon: iconHwModelSilicone }, { name: '外观模型', icon: iconHwModelAppearance }, { name: '结构模型', icon: iconHwModelStructural }, { name: '夹具模型', icon: iconHwModelFixture },
    { name: '模型材料', icon: iconHwModelMaterial }, { name: '其他模型手板', icon: iconHwMisc }
  ],
  '减速机、变速机': [
    { name: '齿轮减速机', icon: iconHwGearboxGear }, { name: '蜗轮减速机', icon: iconHwGearboxWorm }, { name: '摆线减速机', icon: iconHwGearboxCycloid }, { name: '行星减速机', icon: iconHwGearboxPlanetary }, { name: '谐波减速机', icon: iconHwGearboxHarmonic }, { name: '变速机/变速箱', icon: iconHwGearboxBox },
    { name: '减速机配件', icon: iconHwGearboxParts }, { name: '其他减速机', icon: iconHwMisc }
  ],
  '库存五金、工具': [
    { name: '库存紧固件', icon: iconHwScrew }, { name: '库存手工具', icon: iconHwHammer }, { name: '库存电动工具', icon: iconHwDrill }, { name: '库存量具', icon: iconHwCaliper }, { name: '库存磨料', icon: iconHwGrindingWheel }, { name: '库存建筑五金', icon: iconHwPipeClamp },
    { name: '库存通用五金', icon: iconHwCaster }, { name: '其他库存五金', icon: iconHwMisc }
  ],
  '3D打印机': [
    { name: 'FDM 3D打印机', icon: iconHw3dFdm }, { name: '光固化3D打印机', icon: iconHw3dResin }, { name: '工业3D打印机', icon: iconHw3dIndustrial }, { name: '3D打印机配件', icon: iconHw3dParts }, { name: '3D打印耗材', icon: iconHw3dConsumable }, { name: '3D扫描仪', icon: iconHw3dScanner },
    { name: '3D打印服务', icon: iconHwMisc }, { name: '其他3D打印', icon: iconHwMisc }
  ],
  模具标准件: [
    { name: '导柱/导套', icon: iconHwMoldGuide }, { name: '顶针/司筒', icon: iconHwMoldEjector }, { name: '唧嘴/浇口套', icon: iconHwMoldBushing }, { name: '模具弹簧', icon: iconHwMoldSpring }, { name: '定位环/块', icon: iconHwMoldLocating }, { name: '冷却配件', icon: iconHwMoldCooling },
    { name: '模具镶件', icon: iconHwMoldInsert }, { name: '其他模具标准件', icon: iconHwMisc }
  ],
  离合器: [
    { name: '电磁离合器', icon: iconHwClutchEm }, { name: '磁粉离合器', icon: iconHwClutchPowder }, { name: '摩擦离合器', icon: iconHwClutchFriction }, { name: '液压离合器', icon: iconHwClutchHydraulic }, { name: '气动离合器', icon: iconHwClutchPneumatic }, { name: '离合器片/盘', icon: iconHwClutchDisc },
    { name: '离合器轴承', icon: iconHwClutchBearing }, { name: '其他离合器', icon: iconHwMisc }
  ],
  防爆工具: [
    { name: '防爆扳手', icon: iconHwWrenchAdjustable }, { name: '防爆锤子', icon: iconHwHammer }, { name: '防爆钳子', icon: iconHwPlierWire }, { name: '防爆螺丝刀', icon: iconHwScrewdriver }, { name: '防爆工具套装', icon: iconHwToolSetHome }, { name: '铜合金工具', icon: iconHwCopperTool },
    { name: '防爆容器', icon: iconHwExpContainer }, { name: '其他防爆工具', icon: iconHwMisc }
  ],
  量仪: [
    { name: '卡尺', icon: iconHwCaliper }, { name: '千分尺', icon: iconHwMicrometer }, { name: '百分表', icon: iconHwDialIndicator }, { name: '高度规', icon: iconHwHeightGauge }, { name: '角尺/角度仪', icon: iconHwAngleRuler }, { name: '粗糙度仪', icon: iconHwRoughness },
    { name: '量仪套装', icon: iconHwMeasureSet }, { name: '其他量仪', icon: iconHwMisc }
  ],
  刃具: [
    { name: '硬质合金刀具', icon: iconHwCutterCarbide }, { name: '高速钢刀具', icon: iconHwCutterHss }, { name: '可转位刀具', icon: iconHwCutterIndexable }, { name: '铰刀', icon: iconHwReamer }, { name: '镗刀', icon: iconHwBoring }, { name: '铣刀', icon: iconHwMilling },
    { name: '螺纹刀具', icon: iconHwTapDie }, { name: '其他刃具', icon: iconHwMisc }
  ],
  电子焊接工具: [
    { name: '电烙铁/焊台', icon: iconHwSolderIron }, { name: '焊锡丝/条', icon: iconHwSolderWire }, { name: '助焊剂', icon: iconHwFlux }, { name: '拆焊工具', icon: iconHwDesolder }, { name: 'SMD返修台', icon: iconHwReworkStation }, { name: '热熔胶枪', icon: iconHwGlueGun },
    { name: '焊接配件', icon: iconHwSolderParts }, { name: '其他焊接工具', icon: iconHwMisc }
  ],
  办公文教五金: [
    { name: '教学工具套装', icon: iconHwToolSetHome }, { name: '教学模型', icon: iconHwTeachingModel }, { name: '办公五金配件', icon: iconHwOfficeParts }, { name: '展板/白板配件', icon: iconHwWhiteboardParts }, { name: '文件柜锁', icon: iconHwCabinetLock }, { name: '桌台五金', icon: iconHwDeskHardware },
    { name: '会议室五金', icon: iconHwMeetingHardware }, { name: '其他办公文教', icon: iconHwMisc }
  ],
  制动器: [
    { name: '电磁制动器', icon: iconHwBrakeEm }, { name: '磁粉制动器', icon: iconHwBrakePowder }, { name: '气动制动器', icon: iconHwBrakePneumatic }, { name: '液压制动器', icon: iconHwBrakeHydraulic }, { name: '制动盘/鼓', icon: iconPartBrakeDisc }, { name: '制动片/蹄', icon: iconPartBrakePad },
    { name: '制动电机', icon: iconHwBrakeMotor }, { name: '其他制动器', icon: iconHwMisc }
  ],
  作业平台: [
    { name: '剪叉式作业平台', icon: iconHwPlatformScissor }, { name: '铝合金作业平台', icon: iconHwPlatformAlu }, { name: '高空作业车', icon: iconHwPlatformVehicle }, { name: '脚手架', icon: iconHwScaffold }, { name: '折叠作业平台', icon: iconHwPlatformFolding }, { name: '绝缘作业平台', icon: iconHwPlatformInsulated },
    { name: '作业平台配件', icon: iconHwPlatformParts }, { name: '其他作业平台', icon: iconHwMisc }
  ],
  五金工具项目合作: [
    { name: '项目合作', icon: iconQmCoopProject }, { name: '技术合作', icon: iconQmCoopTech }, { name: '合资合作', icon: iconQmCoopJoint }, { name: '其他项目合作', icon: iconQmCoopOther }
  ],
  适老工具: [
    { name: '适老手推车', icon: iconHwHandTruck }, { name: '扶手/栏杆', icon: iconHwElderGrabBar }, { name: '放大阅读工具', icon: iconHwElderMagnifier }, { name: '适老防滑用品', icon: iconAntiSlipMat }, { name: '易操作工具', icon: iconHwScrewdriver }, { name: '适老量具', icon: iconHwCaliper },
    { name: '适老工具套装', icon: iconHwMisc }, { name: '其他适老工具', icon: iconHwMisc }
  ],
  工艺品: [
    { name: '树脂工艺品', icon: iconOfficeResinCraft }, { name: '金属工艺品', icon: iconOfficeMetalCraft }, { name: '玻璃工艺品', icon: iconOfficeGlassCraft }, { name: '陶瓷工艺品', icon: iconOfficeCeramicCraft }, { name: '木质工艺品', icon: iconOfficeWoodCraft }, { name: '其他工艺品', icon: iconOfficeMisc }
  ],
  '气氛、布置用品': [
    { name: '气球', icon: iconOfficeBalloon }, { name: '拉花/彩带', icon: iconOfficeRibbon }, { name: '节日彩灯', icon: iconOfficeFestivalLight }, { name: '布置套装', icon: iconOfficeDecorSet }, { name: '背景布/幕', icon: iconOfficeBackdrop }, { name: '其他气氛布置', icon: iconOfficeMisc }
  ],
  书写工具: [
    { name: '中性笔', icon: iconOfficeGelPen }, { name: '圆珠笔', icon: iconOfficeBallpoint }, { name: '钢笔', icon: iconOfficeFountainPen }, { name: '铅笔/自动铅笔', icon: iconOfficePencil }, { name: '记号笔/白板笔', icon: iconOfficeMarker }, { name: '其他书写工具', icon: iconOfficeMisc }
  ],
  学习文具: [
    { name: '橡皮', icon: iconOfficeEraser }, { name: '尺子/圆规', icon: iconOfficeRuler }, { name: '笔袋/笔盒', icon: iconOfficePencilCase }, { name: '削笔器', icon: iconOfficeSharpener }, { name: '文具套装', icon: iconOfficeStationerySet }, { name: '其他学习文具', icon: iconOfficeMisc }
  ],
  仿真园艺: [
    { name: '仿真花', icon: iconOfficeArtificialFlower }, { name: '仿真绿植', icon: iconOfficeArtificialPlant }, { name: '仿真草坪', icon: iconOfficeArtificialLawn }, { name: '仿真树', icon: iconOfficeArtificialTree }, { name: '仿真果蔬', icon: iconOfficeArtificialFruit }, { name: '其他仿真园艺', icon: iconOfficeMisc }
  ],
  钥匙配饰: [
    { name: '钥匙扣', icon: iconHwKeychain }, { name: '钥匙包', icon: iconOfficeKeyBag }, { name: '钥匙圈/环', icon: iconOfficeKeyRing }, { name: '卡套/证件扣', icon: iconOfficeCardHolder }, { name: '钥匙链', icon: iconOfficeKeyChain }, { name: '其他钥匙配饰', icon: iconOfficeMisc }
  ],
  纸品本册: [
    { name: '笔记本', icon: iconOfficeNotebook }, { name: '记事本', icon: iconOfficeMemoPad }, { name: '线圈本', icon: iconOfficeSpiralBook }, { name: '活页本', icon: iconOfficeLooseLeaf }, { name: '便签本', icon: iconOfficeStickyNote }, { name: '其他纸品本册', icon: iconOfficeMisc }
  ],
  圣诞用品: [
    { name: '圣诞树', icon: iconOfficeChristmasTree }, { name: '圣诞球/挂饰', icon: iconOfficeChristmasBall }, { name: '圣诞帽', icon: iconOfficeChristmasHat }, { name: '圣诞灯串', icon: iconOfficeChristmasLight }, { name: '圣诞袜/礼品袋', icon: iconOfficeChristmasSock }, { name: '其他圣诞用品', icon: iconOfficeMisc }
  ],
  '美术、书法、绘图用品': [
    { name: '颜料', icon: iconOfficePaint }, { name: '画笔/毛笔', icon: iconOfficePaintBrush }, { name: '画板/画架', icon: iconOfficeEasel }, { name: '宣纸/书画纸', icon: iconOfficeXuanPaper }, { name: '调色盘', icon: iconOfficePalette }, { name: '其他美术用品', icon: iconOfficeMisc }
  ],
  办公收纳: [
    { name: '文件架/文件框', icon: iconOfficeFileRack }, { name: '桌面收纳盒', icon: iconHomeDeskOrganizer }, { name: '笔筒', icon: iconOfficePenHolder }, { name: '资料册', icon: iconOfficeDocumentFile }, { name: '收纳篮', icon: iconHomeStorageBasket }, { name: '其他办公收纳', icon: iconOfficeMisc }
  ],
  展示用品: [
    { name: '展示架', icon: iconOfficeDisplayRack }, { name: '广告牌/展示牌', icon: iconOfficeDisplayBoard }, { name: '灯箱', icon: iconOfficeLightBox }, { name: '易拉宝', icon: iconOfficeRollBanner }, { name: '橱窗道具', icon: iconOfficeWindowProp }, { name: '其他展示用品', icon: iconOfficeMisc }
  ],
  '装订、胶粘、桌面用品': [
    { name: '订书机/订书针', icon: iconOfficeStapler }, { name: '打孔器', icon: iconOfficeHolePunch }, { name: '胶水/胶棒', icon: iconOfficeGlue }, { name: '热熔胶枪', icon: iconHwGlueGun }, { name: '桌面垫/桌布', icon: iconOfficeDeskMat }, { name: '其他装订胶粘', icon: iconOfficeMisc }
  ],
  节庆用品: [
    { name: '节日灯笼', icon: iconOfficeLantern }, { name: '彩旗/吊饰', icon: iconOfficeBunting }, { name: '节庆礼盒', icon: iconOfficeFestivalGiftBox }, { name: '派对用品', icon: iconOfficePartySupply }, { name: '庆典道具', icon: iconOfficeCeremonyProp }, { name: '其他节庆用品', icon: iconOfficeMisc }
  ],
  办公设备: [
    { name: '打印机', icon: iconOfficePrinter }, { name: '碎纸机', icon: iconOfficeShredder }, { name: '考勤机', icon: iconOfficeAttendance }, { name: '塑封机', icon: iconOfficeLaminator }, { name: '点钞机', icon: iconOfficeMoneyCounter }, { name: '其他办公设备', icon: iconOfficeMisc }
  ],
  商务礼品: [
    { name: '礼品套装', icon: iconOfficeGiftSet }, { name: '定制奖杯', icon: iconOfficeTrophy }, { name: '商务笔记本', icon: iconOfficeBusinessNotebook }, { name: '礼品U盘', icon: iconOfficeGiftUsb }, { name: '礼品笔', icon: iconOfficeGiftPen }, { name: '其他商务礼品', icon: iconOfficeMisc }
  ],
  婚庆用品: [
    { name: '喜帖/请柬', icon: iconOfficeInvitation }, { name: '婚庆布置', icon: iconOfficeWeddingDecor }, { name: '喜糖盒', icon: iconOfficeCandyBox }, { name: '婚纱配饰', icon: iconOfficeWeddingAccessory }, { name: '红包', icon: iconOfficeRedEnvelope }, { name: '其他婚庆用品', icon: iconOfficeMisc }
  ],
  手账: [
    { name: '手账本', icon: iconOfficePlannerBook }, { name: '和纸胶带', icon: iconOfficeWashiTape }, { name: '贴纸', icon: iconOfficeSticker }, { name: '手账笔', icon: iconOfficePlannerPen }, { name: '手账套装', icon: iconOfficePlannerSet }, { name: '其他手账用品', icon: iconOfficeMisc }
  ],
  乐器: [
    { name: '吉他', icon: iconOfficeGuitar }, { name: '口琴', icon: iconOfficeHarmonica }, { name: '尤克里里', icon: iconOfficeUkulele }, { name: '鼓/打击乐器', icon: iconOfficeDrum }, { name: '笛/箫', icon: iconOfficeFluteCn }, { name: '其他乐器', icon: iconOfficeMisc }
  ],
  行政用品: [
    { name: '印章', icon: iconOfficeSeal }, { name: '印台/印油', icon: iconOfficeInkPad }, { name: '旗帜/旗杆', icon: iconOfficeFlag }, { name: '证件卡套', icon: iconOfficeIdHolder }, { name: '公章盒', icon: iconOfficeSealBox }, { name: '其他行政用品', icon: iconOfficeMisc }
  ],
  创意礼品: [
    { name: '创意摆件', icon: iconOfficeCreativeOrnament }, { name: '创意杯', icon: iconOfficeCreativeCup }, { name: '创意灯', icon: iconOfficeCreativeLight }, { name: '创意玩具', icon: iconOfficeCreativeToy }, { name: '定制礼品', icon: iconOfficeCustomGift }, { name: '其他创意礼品', icon: iconOfficeMisc }
  ],
  工艺摆件: [
    { name: '树脂摆件', icon: iconOfficeResinOrnament }, { name: '金属摆件', icon: iconOfficeMetalOrnament }, { name: '木雕摆件', icon: iconOfficeWoodOrnament }, { name: '陶瓷摆件', icon: iconOfficeCeramicOrnament }, { name: '水晶摆件', icon: iconOfficeCrystalOrnament }, { name: '其他工艺摆件', icon: iconOfficeMisc }
  ],
  办公用纸: [
    { name: '复印纸', icon: iconOfficeCopyPaper }, { name: '打印纸', icon: iconOfficePrintPaper }, { name: '传真纸', icon: iconOfficeFaxPaper }, { name: '收银纸', icon: iconOfficeCashPaper }, { name: '相纸', icon: iconOfficePhotoPaper }, { name: '其他办公用纸', icon: iconOfficeMisc }
  ],
  文化用品: [
    { name: '书签', icon: iconHwBookmark }, { name: '文创产品', icon: iconOfficeCulturalCreative }, { name: '字画', icon: iconOfficePainting }, { name: '香道用品', icon: iconOfficeIncenseWay }, { name: '茶道配件', icon: iconOfficeTeaAccessory }, { name: '其他文化用品', icon: iconOfficeMisc }
  ],
  '动漫/影视/明星周边': [
    { name: '手办', icon: iconOfficeFigure }, { name: '徽章/吧唧', icon: iconOfficeAnimeBadge }, { name: '海报/明信片', icon: iconOfficePoster }, { name: 'cos道具', icon: iconOfficeCosProp }, { name: '挂件', icon: iconOfficeCharm }, { name: '其他周边', icon: iconOfficeMisc }
  ],
  财务用品: [
    { name: '计算器', icon: iconOfficeCalculator }, { name: '账本/账册', icon: iconOfficeAccountBook }, { name: '票据夹', icon: iconOfficeReceiptClip }, { name: '算盘', icon: iconOfficeAbacus }, { name: '财务印章', icon: iconOfficeFinanceSeal }, { name: '其他财务用品', icon: iconOfficeMisc }
  ],
  宗教用品: [
    { name: '佛珠/念珠', icon: iconOfficePrayerBeads }, { name: '香/香炉', icon: iconOfficeIncenseBurner }, { name: '宗教挂件', icon: iconOfficeReligiousPendant }, { name: '供具', icon: iconOfficeOfferingVessel }, { name: '宗教服饰', icon: iconOfficeReligiousGarment }, { name: '其他宗教用品', icon: iconOfficeMisc }
  ],
  耗材: [
    { name: '墨盒/墨仓', icon: iconOfficeInkCartridge }, { name: '硒鼓', icon: iconOfficeTonerCartridge }, { name: '碳粉', icon: iconOfficeTonerPowder }, { name: '色带', icon: iconOfficePrinterRibbon }, { name: '3D打印耗材', icon: iconHw3dConsumable }, { name: '其他耗材', icon: iconOfficeMisc }
  ],
  '书籍、出版物': [
    { name: '图书', icon: iconOfficeBook }, { name: '期刊/杂志', icon: iconOfficeMagazine }, { name: '教辅材料', icon: iconOfficeTeachingAid }, { name: '地图', icon: iconOfficeMap }, { name: '音像制品', icon: iconOfficeAvProduct }, { name: '其他出版物', icon: iconOfficeMisc }
  ],
  '聚会/魔术/演出用品': [
    { name: '魔术道具', icon: iconOfficeMagicProp }, { name: '演出服', icon: iconOfficePerformanceCostume }, { name: '派对面具', icon: iconOfficePartyMask }, { name: '荧光棒', icon: iconOfficeGlowStick }, { name: '舞台道具', icon: iconOfficeStageProp }, { name: '其他演出用品', icon: iconOfficeMisc }
  ],
  '祭祀/殡葬用品': [
    { name: '香烛', icon: iconOfficeCandle }, { name: '纸制品祭祀', icon: iconOfficePaperRitual }, { name: '殡葬服饰', icon: iconOfficeFuneralGarment }, { name: '骨灰盒', icon: iconOfficeUrn }, { name: '祭祀套装', icon: iconOfficeRitualSet }, { name: '其他祭祀用品', icon: iconOfficeMisc }
  ],
  '教学模型、器材': [
    { name: '教学模型', icon: iconHwTeachingModel }, { name: '显微镜', icon: iconOfficeMicroscope }, { name: '地球仪', icon: iconOfficeGlobe }, { name: '教学挂图', icon: iconOfficeTeachingChart }, { name: '实验器材', icon: iconOfficeLabEquipment }, { name: '其他教学器材', icon: iconOfficeMisc }
  ],
  民间工艺品: [
    { name: '剪纸', icon: iconOfficePaperCutting }, { name: '刺绣', icon: iconOfficeEmbroidery }, { name: '泥塑', icon: iconOfficeClayFigure }, { name: '面塑', icon: iconOfficeDoughFigure }, { name: '编织工艺', icon: iconOfficeWeaving }, { name: '其他民间工艺', icon: iconOfficeMisc }
  ],
  工艺品配件: [
    { name: '珠子/散珠', icon: iconOfficeBeads }, { name: '流苏/穗', icon: iconOfficeTassel }, { name: '中国结配件', icon: iconOfficeChinaKnot }, { name: '工艺绳线', icon: iconOfficeCraftCord }, { name: '底座/托架', icon: iconOfficeBaseStand }, { name: '其他工艺品配件', icon: iconOfficeMisc }
  ],
  '邮票/钱币/纪念币': [
    { name: '邮票', icon: iconOfficeStamp }, { name: '纪念币', icon: iconHwCoin }, { name: '钱币册', icon: iconOfficeCoinAlbum }, { name: '收藏卡', icon: iconOfficeCollectionCard }, { name: '鉴定盒', icon: iconOfficeGradingCase }, { name: '其他钱币收藏', icon: iconOfficeMisc }
  ],
  实验室用品: [
    { name: '烧杯', icon: iconOfficeBeaker }, { name: '试管', icon: iconOfficeTestTube }, { name: '量筒', icon: iconOfficeCylinder }, { name: '滴管', icon: iconOfficeDropper }, { name: '实验架', icon: iconOfficeLabRack }, { name: '其他实验室用品', icon: iconOfficeMisc }
  ],
  '古董/古玩/收藏': [
    { name: '瓷器收藏', icon: iconOfficePorcelainCollect }, { name: '玉器收藏', icon: iconOfficeJadeCollect }, { name: '铜器收藏', icon: iconOfficeBronzeCollect }, { name: '字画收藏', icon: iconOfficePaintingCollect }, { name: '收藏盒', icon: iconOfficeCollectBox }, { name: '其他古董收藏', icon: iconOfficeMisc }
  ],
  学习类电子产品: [
    { name: '学习机', icon: iconOfficeStudyMachine }, { name: '点读笔', icon: iconOfficeReadingPen }, { name: '电子词典', icon: iconOfficeEDictionary }, { name: '复读机', icon: iconOfficeRepeater }, { name: '早教机', icon: iconOfficeEarlyEducation }, { name: '其他学习电子', icon: iconOfficeMisc }
  ],
  春节用品: [
    { name: '春联', icon: iconOfficeCouplet }, { name: '窗花', icon: iconOfficeWindowFlower }, { name: '红包/利是封', icon: iconOfficeLaiSee }, { name: '灯笼', icon: iconOfficeLanternCny }, { name: '年画', icon: iconOfficeNewYearPainting }, { name: '其他春节用品', icon: iconOfficeMisc }
  ],
  乐器配件: [
    { name: '琴弦', icon: iconOfficeStrings }, { name: '拨片', icon: iconOfficePick }, { name: '乐器包', icon: iconOfficeInstrumentBag }, { name: '调音器', icon: iconOfficeTuner }, { name: '支架/背带', icon: iconOfficeStandStrap }, { name: '其他乐器配件', icon: iconOfficeMisc }
  ],
  西洋乐器: [
    { name: '小提琴', icon: iconOfficeViolin }, { name: '钢琴', icon: iconOfficePiano }, { name: '萨克斯', icon: iconOfficeSaxophone }, { name: '长笛', icon: iconOfficeFlute }, { name: '电子琴', icon: iconOfficeKeyboard }, { name: '其他西洋乐器', icon: iconOfficeMisc }
  ],
  民族乐器: [
    { name: '古筝', icon: iconOfficeGuzheng }, { name: '琵琶', icon: iconOfficePipa }, { name: '二胡', icon: iconOfficeErhu }, { name: '葫芦丝', icon: iconOfficeHulusi }, { name: '扬琴', icon: iconOfficeYangqin }, { name: '其他民族乐器', icon: iconOfficeMisc }
  ],
  'MIDI乐器/电脑音乐': [
    { name: 'MIDI键盘', icon: iconOfficeMidiKeyboard }, { name: '声卡', icon: iconOfficeSoundCard }, { name: '控制器', icon: iconOfficeMidiController }, { name: '电脑音乐软件', icon: iconOfficeMusicSoftware }, { name: '监听耳机', icon: iconOfficeMonitorHeadphone }, { name: '其他电脑音乐', icon: iconOfficeMisc }
  ]
}
